// Function to process a message
//   const processMessage = async (msg: KaiWorkflowMessage) => {

import {
  KaiWorkflowMessage,
  KaiInteractiveWorkflow,
  KaiWorkflowMessageType,
  KaiUserInteraction,
} from "@editor-extensions/agentic";
import { ExtensionState } from "../../extensionState";
import { ChatMessageType, ToolMessageValue } from "@editor-extensions/shared";
import { handleModifiedFileMessage } from "./handleModifiedFile";
import { MessageQueueManager, handleUserInteractionComplete } from "./queueManager";

import { shouldProcessMessage } from "./shouldProcessMessage";

// Helper function to handle user interaction promises uniformly
const handleUserInteractionPromise = async (
  msg: KaiWorkflowMessage,
  state: ExtensionState,
  queueManager: MessageQueueManager | undefined,
  pendingInteractions: Map<string, (response: any) => void>,
): Promise<void> => {
  // Set waiting flag and set up interaction handling
  state.isWaitingForUserInteraction = true;

  // Set up the pending interaction handler
  await new Promise<void>((resolve) => {
    pendingInteractions.set(msg.id, async (response: any) => {
      // Use the centralized interaction completion handler
      if (queueManager) {
        await handleUserInteractionComplete(state, queueManager);
      } else {
        // Fallback for backward compatibility
        state.isWaitingForUserInteraction = false;
      }

      // Remove the entry from pendingInteractions to prevent memory leaks
      pendingInteractions.delete(msg.id);
      resolve();
    });
  });
};

export const processMessage = async (
  msg: KaiWorkflowMessage,
  state: ExtensionState,
  workflow: KaiInteractiveWorkflow,
  messageQueue: KaiWorkflowMessage[],
  modifiedFilesPromises: Array<Promise<void>>,
  processedTokens: Set<string>,
  pendingInteractions: Map<string, (response: any) => void>,
  maxTaskManagerIterations: number,
  queueManager?: MessageQueueManager,
) => {
  // If we're waiting for user interaction, queue the message for later processing
  if (queueManager && queueManager.shouldQueueMessage()) {
    console.log(
      `Queuing ${msg.type} message ${msg.id} - waiting for user interaction (queue manager)`,
    );
    queueManager.enqueueMessage(msg);
    return;
  } else if (state.isWaitingForUserInteraction) {
    // Fallback to old behavior for backward compatibility
    console.log(
      `Queuing ${msg.type} message ${msg.id} in fallback queue - waiting for user interaction`,
    );
    messageQueue.push(msg);
    return;
  }

  // CRITICAL: Before processing this message, ensure any queued messages are processed first
  // This prevents race conditions where new messages bypass queued ones
  // BUT only if we're not already in the middle of processing the queue (to prevent infinite recursion)
  // AND only if we're not waiting for user interaction (to maintain proper order)
  if (
    queueManager &&
    queueManager.getQueueLength() > 0 &&
    !queueManager.isProcessingQueueActive() &&
    !state.isWaitingForUserInteraction
  ) {
    console.log(`Processing queued messages before handling ${msg.type} message ${msg.id}`);
    // First, queue the current message to maintain order
    queueManager.enqueueMessage(msg);
    // Then process all queued messages (including the one we just added)
    await queueManager.processQueuedMessages();
    return;
  }

  // Check if we should process this message or skip it as a duplicate
  if (!shouldProcessMessage(msg, state.lastMessageId, processedTokens)) {
    return;
  }

  // Double-check that we're not waiting for user interaction before processing
  if (state.isWaitingForUserInteraction) {
    console.warn(
      `Attempting to process ${msg.type} message ${msg.id} while waiting for user interaction - this should not happen`,
    );
    // Queue the message instead of processing it
    if (queueManager) {
      queueManager.enqueueMessage(msg);
    } else {
      messageQueue.push(msg);
    }
    return;
  }

  switch (msg.type) {
    case KaiWorkflowMessageType.ToolCall: {
      // Add or update tool call notification in chat
      state.mutateData((draft) => {
        const toolName = msg.data.name || "unnamed tool";
        const toolStatus = msg.data.status;
        // Check if the most recent message is a tool message with the same name
        let updateExisting = false;
        if (draft.chatMessages.length > 0) {
          const lastMessage = draft.chatMessages[draft.chatMessages.length - 1];
          if (
            lastMessage.kind === ChatMessageType.Tool &&
            (lastMessage.value as ToolMessageValue).toolName === toolName
          ) {
            updateExisting = true;
          }
        }

        if (updateExisting) {
          // Update the status of the most recent tool message
          draft.chatMessages[draft.chatMessages.length - 1].value = {
            toolName,
            toolStatus,
          };
          draft.chatMessages[draft.chatMessages.length - 1].timestamp = new Date().toISOString();
        } else {
          // Add a new tool message if the most recent message is not the same tool
          draft.chatMessages.push({
            kind: ChatMessageType.Tool,
            messageToken: msg.id,
            timestamp: new Date().toISOString(),
            value: {
              toolName,
              toolStatus,
            },
          });
        }
      });
      break;
    }
    case KaiWorkflowMessageType.UserInteraction: {
      const interaction = msg.data as KaiUserInteraction;
      switch (interaction.type) {
        case "yesNo": {
          try {
            // Get the message from the interaction
            const message = interaction.systemMessage.yesNo || "Would you like to proceed?";

            // Add the question to chat with quick responses
            state.mutateData((draft) => {
              // Always add the interaction message - don't skip based on existing interactions
              // Multiple interactions can be pending at the same time
              draft.chatMessages.push({
                kind: ChatMessageType.String,
                messageToken: msg.id,
                timestamp: new Date().toISOString(),
                value: {
                  message: message,
                },
                quickResponses: [
                  { id: "yes", content: "Yes" },
                  { id: "no", content: "No" },
                ],
              });
              console.log(`Added yesNo interaction message with ID: ${msg.id}`);
            });

            // Handle user interaction promise
            await handleUserInteractionPromise(msg, state, queueManager, pendingInteractions);
            break;
          } catch (error) {
            console.error("Error handling user interaction:", error);
            msg.data.response = { yesNo: false };
            await workflow.resolveUserInteraction(msg);
          }
          break;
        }
        case "choice": {
          try {
            const choices = interaction.systemMessage.choice || [];
            state.mutateData((draft) => {
              draft.chatMessages.push({
                kind: ChatMessageType.String,
                messageToken: msg.id,
                timestamp: new Date().toISOString(),
                value: {
                  message: "Please select an option:",
                },
                quickResponses: choices.map((choice: string, index: number) => ({
                  id: `choice-${index}`,
                  content: choice,
                })),
              });
              console.log(`Added choice interaction message with ID: ${msg.id}`);
            });

            // Handle user interaction promise
            await handleUserInteractionPromise(msg, state, queueManager, pendingInteractions);
            break;
          } catch (error) {
            console.error("Error handling choice interaction:", error);
            msg.data.response = { choice: -1 };
            await workflow.resolveUserInteraction(msg);
          }
          break;
        }
        case "tasks": {
          if (state.currentTaskManagerIterations < maxTaskManagerIterations) {
            state.currentTaskManagerIterations += 1;

            // Wait for analysis to complete with a timeout to prevent hanging
            console.log(
              `Tasks interaction: Waiting for analysis to complete... (iteration ${state.currentTaskManagerIterations}/${maxTaskManagerIterations})`,
            );
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                clearInterval(interval);
                console.warn(
                  `Tasks interaction timed out waiting for analysis to complete after 30 seconds`,
                );
                resolve(); // Resolve anyway to prevent hanging
              }, 30000); // 30 second timeout

              const interval = setInterval(() => {
                if (!state.data.isAnalysisScheduled && !state.data.isAnalyzing) {
                  clearInterval(interval);
                  clearTimeout(timeout);
                  console.log(`Tasks interaction: Analysis completed, proceeding with task check`);
                  resolve();
                  return;
                }
              }, 1000);
            });
            const tasks = state.taskManager.getTasks().map((t) => {
              return {
                uri: t.getUri().fsPath,
                task:
                  t.toString().length > 100
                    ? t.toString().slice(0, 100).replaceAll("`", "'").replaceAll(">", "") + "..."
                    : t.toString(),
              } as { uri: string; task: string };
            });
            if (tasks.length > 0) {
              state.mutateData((draft) => {
                draft.chatMessages.push({
                  kind: ChatMessageType.String,
                  messageToken: msg.id,
                  timestamp: new Date().toISOString(),
                  value: {
                    message: `It appears that my fixes caused following issues:\n\n - \
                              ${[...new Set(tasks.map((t) => t.task))].join("\n * ")}\n\nDo you want me to continue fixing them?`,
                    tasksData: tasks, // Store tasks data for retrieval in quick response handler
                  },
                  quickResponses: [
                    { id: "yes", content: "Yes" },
                    { id: "no", content: "No" },
                  ],
                });
                console.log(`Added tasks interaction message with ID: ${msg.id}`);
              });

              // Handle user interaction promise
              await handleUserInteractionPromise(msg, state, queueManager, pendingInteractions);
            } else {
              msg.data.response = {
                yesNo: false,
              };
              workflow.resolveUserInteraction(msg);
            }
          } else {
            msg.data.response = {
              yesNo: false,
            };
            workflow.resolveUserInteraction(msg);
          }
        }
      }
      break;
    }
    case KaiWorkflowMessageType.LLMResponseChunk: {
      const chunk = msg.data;
      let content: string;
      if (typeof chunk.content === "string") {
        content = chunk.content;
      } else {
        try {
          content = JSON.stringify(chunk.content);
        } catch (error) {
          console.error("Error serializing chunk content:", error);
          content =
            "[Error: Unable to serialize content - possible circular reference or serialization issue]";
        }
      }

      if (msg.id !== state.lastMessageId) {
        // This is a new message - create a new chat message
        state.mutateData((draft) => {
          draft.chatMessages.push({
            kind: ChatMessageType.String,
            messageToken: msg.id,
            timestamp: new Date().toISOString(),
            value: {
              message: content,
            },
          });
        });
        state.lastMessageId = msg.id;
      } else {
        // This is a continuation of the current message - append to it
        state.mutateData((draft) => {
          if (draft.chatMessages.length > 0) {
            draft.chatMessages[draft.chatMessages.length - 1].value.message += content;
          } else {
            // If there are no messages, create a new one instead
            draft.chatMessages.push({
              kind: ChatMessageType.String,
              messageToken: msg.id,
              timestamp: new Date().toISOString(),
              value: {
                message: content,
              },
            });
          }
        });
      }
      break;
    }
    case KaiWorkflowMessageType.ModifiedFile: {
      await handleModifiedFileMessage(
        msg,
        state.modifiedFiles,
        modifiedFilesPromises,
        processedTokens,
        pendingInteractions,
        messageQueue,
        state,
        queueManager,
        state.modifiedFilesEventEmitter,
      );
      break;
    }
  }
};
