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

// Helper function to wait for analysis completion with timeout
const waitForAnalysisCompletion = async (state: ExtensionState): Promise<void> => {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      clearInterval(interval);
      console.warn("Tasks interaction: Analysis wait timed out after 30 seconds");
      resolve();
    }, 30000);

    const interval = setInterval(() => {
      const isAnalyzing = state.data.isAnalyzing;
      const isAnalysisScheduled = state.data.isAnalysisScheduled;

      if (!isAnalysisScheduled && !isAnalyzing) {
        clearInterval(interval);
        clearTimeout(timeout);
        console.log("Tasks interaction: Analysis completed");
        resolve();
      }
    }, 1000);
  });
};

// Helper function to reset stuck analysis flags
const resetStuckAnalysisFlags = (state: ExtensionState): void => {
  if (state.data.isAnalyzing || state.data.isAnalysisScheduled) {
    console.warn("Tasks interaction: Force resetting stuck analysis flags");
    state.mutateData((draft) => {
      draft.isAnalyzing = false;
      draft.isAnalysisScheduled = false;
    });
  }
};

// Helper function to format tasks for display
const formatTasksForDisplay = (tasks: any[]): { uri: string; task: string }[] => {
  return tasks.map((t) => ({
    uri: t.getUri().fsPath,
    task:
      t.toString().length > 100
        ? t.toString().slice(0, 100).replaceAll("`", "'").replaceAll(">", "") + "..."
        : t.toString(),
  }));
};

// Helper function to create tasks message
const createTasksMessage = (tasks: { uri: string; task: string }[]): string => {
  const uniqueTasks = [...new Set(tasks.map((t) => t.task))];
  return `It appears that my fixes caused following issues:\n\n - ${uniqueTasks.join("\n * ")}\n\nDo you want me to continue fixing them?`;
};

// Helper function to handle user interaction promises uniformly
const handleUserInteractionPromise = async (
  msg: KaiWorkflowMessage,
  state: ExtensionState,
  queueManager: MessageQueueManager | undefined,
  pendingInteractions: Map<string, (response: any) => void>,
): Promise<void> => {
  state.isWaitingForUserInteraction = true;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn(`User interaction timeout for message ${msg.id}`);
      pendingInteractions.delete(msg.id);
      state.isWaitingForUserInteraction = false;
      resolve();
    }, 60000);

    pendingInteractions.set(msg.id, async (response: any) => {
      clearTimeout(timeout);

      if (queueManager) {
        await handleUserInteractionComplete(state, queueManager);
      } else {
        state.isWaitingForUserInteraction = false;
      }

      pendingInteractions.delete(msg.id);
      resolve();
    });
  });
};

// Main function to handle tasks interaction
const handleTasksInteraction = async (
  msg: KaiWorkflowMessage,
  state: ExtensionState,
  workflow: KaiInteractiveWorkflow,
  queueManager: MessageQueueManager | undefined,
  pendingInteractions: Map<string, (response: any) => void>,
  maxTaskManagerIterations: number,
): Promise<void> => {
  // Check if we've exceeded max iterations
  if (state.currentTaskManagerIterations >= maxTaskManagerIterations) {
    (msg.data as KaiUserInteraction).response = { yesNo: false };
    await workflow.resolveUserInteraction(msg as any);
    return;
  }

  // Increment iteration counter
  state.currentTaskManagerIterations += 1;

  // Wait for analysis to complete
  await waitForAnalysisCompletion(state);

  // Reset any stuck analysis flags
  resetStuckAnalysisFlags(state);

  // Get and format tasks
  const rawTasks = state.taskManager.getTasks();
  const tasks = formatTasksForDisplay(rawTasks);

  if (tasks.length === 0) {
    // No tasks found - auto-reject
    (msg.data as KaiUserInteraction).response = { yesNo: false };
    await workflow.resolveUserInteraction(msg as any);
    return;
  }
  // Show tasks to user and wait for response
  state.mutateData((draft) => {
    draft.chatMessages.push({
      kind: ChatMessageType.String,
      messageToken: msg.id,
      timestamp: new Date().toISOString(),
      value: {
        message: createTasksMessage(tasks),
        tasksData: tasks,
      },
      quickResponses: [
        { id: "yes", content: "Yes" },
        { id: "no", content: "No" },
      ],
    });
  });

  await handleUserInteractionPromise(msg, state, queueManager, pendingInteractions);
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
    queueManager.enqueueMessage(msg);
    return;
  } else if (state.isWaitingForUserInteraction) {
    // Fallback to old behavior for backward compatibility
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
          await handleTasksInteraction(
            msg,
            state,
            workflow,
            queueManager,
            pendingInteractions,
            maxTaskManagerIterations,
          );
          break;
        }
        default: {
          console.warn(`Unknown user interaction type: ${interaction.type}, auto-rejecting`);
          (msg.data as KaiUserInteraction).response = { yesNo: false };
          await workflow.resolveUserInteraction(msg as any);
          break;
        }
      }
      break;
    }
    case KaiWorkflowMessageType.LLMResponseChunk: {
      const chunk = msg.data as any;
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
