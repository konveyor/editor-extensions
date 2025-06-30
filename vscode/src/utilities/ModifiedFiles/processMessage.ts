// Function to process a message
//   const processMessage = async (msg: KaiWorkflowMessage) => {

import {
  KaiWorkflowMessage,
  KaiInteractiveWorkflow,
  KaiWorkflowMessageType,
  KaiUserIteraction,
} from "@editor-extensions/agentic";
import { ExtensionState } from "src/extensionState";
import { ChatMessageType, ToolMessageValue } from "@editor-extensions/shared";
import { handleModifiedFileMessage } from "./handleModifiedFile";

import { shouldProcessMessage } from "./shouldProcessMessage";

let lastMessageId: string = "0";

export const processMessage = async (
  msg: KaiWorkflowMessage,
  state: ExtensionState,
  workflow: KaiInteractiveWorkflow,
  messageQueue: KaiWorkflowMessage[],
  modifiedFilesPromises: Array<Promise<void>>,
  processedTokens: Set<string>,
  pendingInteractions: Map<string, (response: any) => void>,
  currentTaskManagerIterations: number,
  maxTaskManagerIterations: number,
) => {
  console.log("Commands processing message:", msg);

  // If we're waiting for user interaction and this is not a response to that interaction,
  // queue the message for later processing
  if (state.isWaitingForUserInteraction) {
    messageQueue.push(msg);
    return;
  }

  // Check if we should process this message or skip it as a duplicate
  if (!shouldProcessMessage(msg, lastMessageId, processedTokens)) {
    return;
  }

  switch (msg.type) {
    case KaiWorkflowMessageType.ToolCall: {
      // Add or update tool call notification in chat
      state.mutateData((draft) => {
        const toolName = msg.data.name || "unnamed tool";
        const toolStatus = msg.data.status;
        // Use a dedicated kind and value for tool messages
        const existingToolIndex = draft.chatMessages.findIndex(
          (m: any) =>
            m.kind === ChatMessageType.Tool &&
            (m.value as ToolMessageValue).toolName === toolName &&
            (m.value as ToolMessageValue).toolStatus === toolStatus,
        );

        if (existingToolIndex === -1) {
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
      const interaction = msg.data as KaiUserIteraction;
      switch (interaction.type) {
        case "yesNo": {
          try {
            // Get the message from the interaction
            const message = interaction.systemMessage.yesNo || "Would you like to proceed?";

            // Add the question to chat with quick responses
            state.mutateData((draft) => {
              // Check if we already have a pending interaction message
              const hasPendingInteraction = draft.chatMessages.some(
                (m: any) =>
                  m.kind === ChatMessageType.String &&
                  m.quickResponses &&
                  m.quickResponses.length > 0,
              );

              if (!hasPendingInteraction) {
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
              }
            });
            // Response will be handled by QUICK_RESPONSE handler
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
            // Response will be handled by QUICK_RESPONSE handler
            break;
          } catch (error) {
            console.error("Error handling choice interaction:", error);
            msg.data.response = { choice: -1 };
            await workflow.resolveUserInteraction(msg);
          }
          break;
        }
        case "tasks": {
          if (currentTaskManagerIterations < maxTaskManagerIterations) {
            currentTaskManagerIterations += 1;
            await new Promise<void>((resolve) => {
              const interval = setInterval(() => {
                if (!state.data.isAnalysisScheduled && !state.data.isAnalyzing) {
                  clearInterval(interval);
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
                  },
                });
              });
              msg.data.response = { tasks, yesNo: true };
              workflow.resolveUserInteraction(msg);
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
      console.log("LLMResponseChunk", msg);
      const chunk = msg.data;
      const content =
        typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);

      if (msg.id !== lastMessageId) {
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
        lastMessageId = msg.id;
      } else {
        // This is a continuation of the current message - append to it
        state.mutateData((draft) => {
          draft.chatMessages[draft.chatMessages.length - 1].value.message += content;
        });
      }
      break;
    }
    case KaiWorkflowMessageType.ModifiedFile: {
      await handleModifiedFileMessage(
        msg,
        state.modifiedFiles,
        modifiedFilesPromises as any, // Temporary cast to bypass type issue
        processedTokens,
        pendingInteractions,
        messageQueue,
        state,
      );
      break;
    }
  }
};
