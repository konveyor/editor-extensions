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
    state.mutate((draft) => {
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
  state.mutate((draft) => {
    draft.isWaitingForUserInteraction = true;
  });

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      console.warn(`User interaction timeout for message ${msg.id}`);
      pendingInteractions.delete(msg.id);
      state.mutate((draft) => {
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
  const logger = state.logger.child({ component: "handleTasksInteraction" });

  // Increment iteration counter
  state.currentTaskManagerIterations += 1;
  logger.debug("Starting tasks interaction", {
    messageId: msg.id,
    iteration: state.currentTaskManagerIterations,
  });

  // Wait for analysis to complete
  await waitForAnalysisCompletion(state);

  // Reset any stuck analysis flags
  resetStuckAnalysisFlags(state);

  // Get and format tasks
  const rawTasks = state.taskManager.getTasks();

  if (rawTasks.currentTasks.length === 0) {
    // No tasks found - auto-reject
    logger.info("No tasks found - auto-rejecting", { messageId: msg.id });
    (msg.data as KaiUserInteraction).response = { yesNo: false };
    try {
      await workflow.resolveUserInteraction(msg as any);
      logger.info("Successfully resolved tasks interaction with no tasks", { messageId: msg.id });
    } catch (error) {
      logger.error("Error resolving tasks interaction", { messageId: msg.id, error });
    }
    return;
  }

  logger.info("Tasks found - showing to user", {
    messageId: msg.id,
    taskCount: rawTasks.currentTasks.length,
  });

  // Show tasks to user and wait for response
  state.mutate((draft) => {
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
  logger.debug("Tasks interaction promise completed", { messageId: msg.id });
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
  const logger = state.logger.child({ component: "processMessageByType" });

  switch (msg.type) {
    case KaiWorkflowMessageType.ToolCall: {
      logger.debug("Processing ToolCall message", {
        messageId: msg.id,
        toolName: msg.data.name,
        toolStatus: msg.data.status,
      });
      state.mutate((draft) => {
        const toolName = msg.data.name || "unnamed tool";
        const toolStatus = msg.data.status;
        const toolResult = msg.data.result as string | undefined;
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
          draft.chatMessages[draft.chatMessages.length - 1].value = {
            toolName,
            toolStatus,
            toolResult,
          };
          draft.chatMessages[draft.chatMessages.length - 1].timestamp = new Date().toISOString();
        } else {
          draft.chatMessages.push({
            kind: ChatMessageType.Tool,
            messageToken: msg.id,
            timestamp: new Date().toISOString(),
            value: {
              toolName,
              toolStatus,
              toolResult,
            },
          });
        }
      });
      break;
    }
    case KaiWorkflowMessageType.UserInteraction: {
      logger.info("Processing UserInteraction message", {
        messageId: msg.id,
        interactionType: (msg.data as KaiUserInteraction).type,
      });
      const interaction = msg.data as KaiUserInteraction;
      switch (interaction.type) {
        case "yesNo": {
          try {
            // Get the message from the interaction
            const message = interaction.systemMessage.yesNo || "Would you like to proceed?";

            // Add the question to chat with quick responses
            state.mutate((draft) => {
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
            state.mutate((draft) => {
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
        state.logger.info(`[Streaming] New message, content length: ${content.length}`, {
          messageId: msg.id,
          preview: content.substring(0, 50),
        });
        state.mutate((draft) => {
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
        state.mutate((draft) => {
          // Find the target message by token -- tool messages may have been
          // inserted after the text message we need to append to.
          for (let i = draft.chatMessages.length - 1; i >= 0; i--) {
            const target = draft.chatMessages[i];
            if (target.messageToken === msg.id && target.kind === ChatMessageType.String) {
              target.value.message += content;
              target.timestamp = new Date().toISOString();
              break;
            }
          }
        });
      }
      break;
    }
    case KaiWorkflowMessageType.LLMResponse: {
      logger.info("Processing LLMResponse message", { messageId: msg.id });
      break;
    }
    case KaiWorkflowMessageType.ModifiedFile: {
      logger.info("Processing ModifiedFile message", {
        messageId: msg.id,
        filePath: (msg.data as any)?.path,
      });
      await handleModifiedFileMessage(
        msg,
        state.modifiedFiles,
        modifiedFilesPromises,
        processedTokens,
        state,
        state.modifiedFilesEventEmitter,
      );
      break;
    }
    case KaiWorkflowMessageType.Error: {
      const errorMessage = msg.data as string;
      logger.error("Processing Error message", { messageId: msg.id, errorMessage });

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

        state.mutate((draft) => {
          draft.llmErrors.push(llmError);
        });
      } else {
        // For non-LLM errors, just add to chat messages
        state.mutate((draft) => {
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
    default: {
      const unhandled = msg as KaiWorkflowMessage;
      logger.warn("Unhandled message type in processMessageByType", {
        messageId: unhandled.id,
        messageType: unhandled.type,
        messageTypeName: KaiWorkflowMessageType[unhandled.type] ?? "UNKNOWN",
        dataKeys: unhandled.data ? Object.keys(unhandled.data as object) : [],
      });
      break;
    }
  }
};
