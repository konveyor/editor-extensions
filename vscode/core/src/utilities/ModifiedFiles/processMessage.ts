// Function to process a message
//   const processMessage = async (msg: KaiWorkflowMessage) => {

import {
  KaiWorkflowMessage,
  KaiInteractiveWorkflow,
  KaiWorkflowMessageType,
  KaiUserInteraction,
} from "@editor-extensions/agentic";
import { flattenCurrentTasks, summarizeTasks, type TasksList } from "../../taskManager";
import { ExtensionState } from "../../extensionState";
import { ChatMessageType, ToolMessageValue, createLLMError } from "@editor-extensions/shared";
import { handleModifiedFileMessage } from "./handleModifiedFile";
import { MessageQueueManager, handleUserInteractionComplete } from "./queueManager";

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

// Helper function to create tasks message
const createTasksMessage = (tasks: TasksList): string => {
  return `It appears that my fixes caused following issues:\n\n${summarizeTasks(tasks)}\n\nDo you want me to continue fixing them?`;
};

// Helper function to handle user interaction promises uniformly
const handleUserInteractionPromise = async (
  msg: KaiWorkflowMessage,
  state: ExtensionState,
  queueManager: MessageQueueManager,
  pendingInteractions: Map<string, (response: any) => void>,
): Promise<void> => {
  state.mutateData((draft) => {
    draft.isWaitingForUserInteraction = true;
  });

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn(`User interaction timeout for message ${msg.id}`);
      pendingInteractions.delete(msg.id);
      state.mutateData((draft) => {
        draft.isWaitingForUserInteraction = false;
      });
      resolve();
    }, 60000);

    pendingInteractions.set(msg.id, async (_response: any) => {
      clearTimeout(timeout);

      await handleUserInteractionComplete(state, queueManager);

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
  queueManager: MessageQueueManager,
  pendingInteractions: Map<string, (response: any) => void>,
): Promise<void> => {
  // Increment iteration counter
  state.currentTaskManagerIterations += 1;

  // Wait for analysis to complete
  await waitForAnalysisCompletion(state);

  // Reset any stuck analysis flags
  resetStuckAnalysisFlags(state);

  // Get and format tasks
  const rawTasks = state.taskManager.getTasks();

  if (rawTasks.currentTasks.length === 0) {
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
        message: createTasksMessage(rawTasks),
        tasksData: flattenCurrentTasks(rawTasks),
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
  queueManager: MessageQueueManager,
) => {
  // ALWAYS queue ALL messages - let queue manager decide when to process
  queueManager.enqueueMessage(msg);

  // Trigger queue processing if not currently processing and not waiting for user
  if (!queueManager.isProcessingQueueActive() && !state.data.isWaitingForUserInteraction) {
    // Don't await - let it run in background
    queueManager.processQueuedMessages().catch((error) => {
      console.error("Error in background queue processing:", error);
    });
  }
};

/**
 * Core message processing logic without queue management
 */
export const processMessageByType = async (
  msg: KaiWorkflowMessage,
  state: ExtensionState,
  workflow: KaiInteractiveWorkflow,
  modifiedFilesPromises: Array<Promise<void>>,
  processedTokens: Set<string>,
  pendingInteractions: Map<string, (response: any) => void>,
  queueManager: MessageQueueManager,
): Promise<void> => {
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
          await handleTasksInteraction(msg, state, workflow, queueManager, pendingInteractions);
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
        state,
        queueManager,
        state.modifiedFilesEventEmitter,
      );
      break;
    }
    case KaiWorkflowMessageType.Error: {
      // Handle error messages from the workflow (including LLM errors)
      const errorMessage = msg.data as string;
      state.logger.error("Workflow error received:", errorMessage);

      // Check if this is an LLM-specific error based on the error message
      // The workflow emits "Failed to get llm response - " prefix for LLM errors
      if (errorMessage.includes("Failed to get llm response")) {
        // Extract the actual error message after the prefix
        const actualError = errorMessage.replace("Failed to get llm response - ", "");
        const lowerError = actualError.toLowerCase();

        // Categorize the LLM error based on the actual error content
        let llmError;
        if (lowerError.includes("timeout") || lowerError.includes("timed out")) {
          llmError = createLLMError.llmTimeout();
        } else if (lowerError.includes("rate limit") || lowerError.includes("429")) {
          llmError = createLLMError.llmRateLimit();
        } else if (
          lowerError.includes("context length") ||
          lowerError.includes("token limit") ||
          lowerError.includes("context_length_exceeded") ||
          lowerError.includes("max_tokens")
        ) {
          llmError = createLLMError.llmContextLimit();
        } else if (
          lowerError.includes("parse") ||
          lowerError.includes("json") ||
          lowerError.includes("invalid response")
        ) {
          llmError = createLLMError.llmResponseParseFailed(actualError);
        } else {
          llmError = createLLMError.llmRequestFailed(actualError);
        }

        state.mutateData((draft) => {
          draft.llmErrors.push(llmError);
        });
      } else {
        // For non-LLM errors, just add to chat messages
        state.mutateData((draft) => {
          draft.chatMessages.push({
            kind: ChatMessageType.String,
            messageToken: msg.id,
            timestamp: new Date().toISOString(),
            value: {
              message: `Error: ${errorMessage}`,
            },
          });
        });
      }
      break;
    }
  }
};
