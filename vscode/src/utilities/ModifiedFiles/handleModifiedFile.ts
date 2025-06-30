import {
  KaiWorkflowMessage,
  KaiWorkflowMessageType,
  KaiModifiedFile,
} from "@editor-extensions/agentic";
import { createTwoFilesPatch, createPatch } from "diff";
import { ExtensionState } from "src/extensionState";
import { Uri } from "vscode";
import { ModifiedFileState, ChatMessageType } from "@editor-extensions/shared";
import { processModifiedFile } from "./processModifiedFile";
import { processMessage } from "./processMessage";

/**
 * Handles a modified file message from the agent
 * 1. Processes the file modification
 * 2. Creates a diff for UI display
 * 3. Adds a chat message with accept/reject buttons
 * 4. Waits for user response before continuing
 */
export const handleModifiedFileMessage = async (
  msg: KaiWorkflowMessage,
  modifiedFiles: Map<string, ModifiedFileState>,
  modifiedFilesPromises: Array<Promise<void>>,
  processedTokens: Set<string>,
  pendingInteractions: Map<string, (response: any) => void>,
  messageQueue: KaiWorkflowMessage[],
  state: ExtensionState,
) => {
  // Ensure we're dealing with a ModifiedFile message
  if (msg.type !== KaiWorkflowMessageType.ModifiedFile) {
    console.error("handleModifiedFileMessage called with non-ModifiedFile message type");
    return;
  }

  // Get file info for UI display
  const { path: filePath } = msg.data as KaiModifiedFile;

  // Process the modified file and store it in the modifiedFiles map
  modifiedFilesPromises.push(processModifiedFile(modifiedFiles, msg.data as KaiModifiedFile));

  const uri = Uri.file(filePath);

  try {
    // Wait for the file to be processed
    await Promise.all(modifiedFilesPromises);

    // Get file state from modifiedFiles map
    const fileState = modifiedFiles.get(uri.fsPath);
    if (fileState) {
      // Create a diff for UI display
      const isNew = fileState.originalContent === undefined;
      let diff: string;

      if (isNew) {
        diff = createTwoFilesPatch("", filePath, "", fileState.modifiedContent);
      } else {
        try {
          diff = createPatch(
            filePath,
            fileState.originalContent as string,
            fileState.modifiedContent,
          );
        } catch (diffErr) {
          console.error(`Error creating diff for ${filePath}:`, diffErr);
          diff = `// Error creating diff for ${filePath}`;
        }
      }

      // Add a chat message with quick responses for user interaction
      state.mutateData((draft) => {
        draft.chatMessages.push({
          kind: ChatMessageType.ModifiedFile,
          messageToken: msg.id,
          timestamp: new Date().toISOString(),
          value: {
            path: filePath,
            content: fileState.modifiedContent,
            isNew: isNew,
            diff: diff,
            messageToken: msg.id, // Add message token to value for reference
          },
          quickResponses: [
            { id: "apply", content: "Apply" },
            { id: "reject", content: "Reject" },
          ],
        });
      });

      // Set the flag to indicate we're waiting for user interaction
      state.isWaitingForUserInteraction = true;
      console.log(`Waiting for user response for file: ${filePath}`);

      // Wait for user response - this blocks workflow execution until user responds
      await new Promise<void>((resolve) => {
        // Store the resolver for this specific message
        pendingInteractions.set(msg.id, (response: any) => {
          // Handle the user response (apply/reject the file change)
          console.log(`User ${response.action} file modification for ${filePath}`);

          // Reset the waiting flag
          state.isWaitingForUserInteraction = false;

          // Process any messages that were queued while waiting
          const queuedMessages = [...messageQueue];
          messageQueue.length = 0;

          // Process all queued messages before resolving the promise
          // This ensures all messages are processed before continuing the workflow
          (async () => {
            try {
              console.log(`Processing ${queuedMessages.length} queued messages...`);

              // Add a processing indicator
              // if (queuedMessages.length > 0) {
              //   state.mutateData((draft) => {
              //     draft.chatMessages.push({
              //       kind: ChatMessageType.String,
              //       messageToken: `queue-start-${Date.now()}`,
              //       timestamp: new Date().toISOString(),
              //       value: {
              //         message: `Processing ${queuedMessages.length} queued messages...`,
              //       },
              //     });
              //   });
              // }

              // Filter out any duplicate messages before processing
              // For ModifiedFile messages, consider them duplicates if they modify the same file path
              const uniqueQueuedMessages = queuedMessages.filter((msg, index, self) => {
                if (msg.type === KaiWorkflowMessageType.ModifiedFile) {
                  // For file modifications, check if we already have a message for this file path
                  const filePath = (msg.data as KaiModifiedFile).path;
                  return (
                    self.findIndex(
                      (m) =>
                        m.type === KaiWorkflowMessageType.ModifiedFile &&
                        (m.data as KaiModifiedFile).path === filePath,
                    ) === index
                  );
                }
                // For other message types, just check the ID
                return self.findIndex((m) => m.id === msg.id) === index;
              });

              console.log(
                `Processing ${uniqueQueuedMessages.length} unique messages out of ${queuedMessages.length} queued messages`,
              );

              // Process each unique message sequentially
              for (const queuedMsg of uniqueQueuedMessages) {
                await processMessage(
                  queuedMsg,
                  state,
                  state.workflowManager.getWorkflow(),
                  messageQueue,
                  modifiedFilesPromises,
                  processedTokens,
                  pendingInteractions,
                  0, // currentTaskManagerIterations
                  1, // maxTaskManagerIterations
                );
              }

              // Add a completion indicator
              // if (queuedMessages.length > 0) {
              //   state.mutateData((draft) => {
              //     draft.chatMessages.push({
              //       kind: ChatMessageType.String,
              //       messageToken: `queue-complete-${Date.now()}`,
              //       timestamp: new Date().toISOString(),
              //       value: {
              //         message: "✅ All queued messages have been processed.",
              //       },
              //     });
              //   });
              // }

              // After processing queued messages
              const hasPendingFileModifications = Array.from(modifiedFiles.values()).some(
                (file) =>
                  file.editType === "inMemory" && file.modifiedContent !== file.originalContent,
              );
              const hasMoreQueuedMessages = messageQueue.length > 0;
              state.mutateData((draft) => {
                const hasUserInteractionMessages = draft.chatMessages.some(
                  (msg) =>
                    msg.kind === ChatMessageType.String &&
                    msg.quickResponses &&
                    msg.quickResponses.length > 0,
                );
                console.log({
                  hasPendingFileModifications,
                  hasMoreQueuedMessages,
                  hasUserInteractionMessages,
                  modifiedFiles,
                });
                // draft.chatMessages.push({
                //   kind: ChatMessageType.String,
                //   messageToken: `queue-status-${Date.now()}`,
                //   timestamp: new Date().toISOString(),
                //   value: {
                //     message: !hasMoreQueuedMessages && !hasUserInteractionMessages
                //       ? "✅ All changes have been processed. You're up to date!"
                //       : "There are more changes to review.",
                //   },
                //   quickResponses:
                //     !hasPendingFileModifications && !hasMoreQueuedMessages && !hasUserInteractionMessages
                //       ? [
                //           { id: "run-analysis", content: "Run Analysis" },
                //           { id: "return-analysis", content: "Return to Analysis Page" },
                //         ]
                //       : undefined,
                // });
              });

              // Resolve our promise to continue the workflow
              resolve();
            } catch (error) {
              console.error("Error processing queued messages:", error);

              // Add an error indicator
              state.mutateData((draft) => {
                draft.chatMessages.push({
                  kind: ChatMessageType.String,
                  messageToken: `queue-error-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  value: {
                    message: `Error processing queued messages: ${error}`,
                  },
                });
              });

              resolve(); // Resolve anyway to prevent hanging
            }
          })();
        });
      });
    }
  } catch (err) {
    console.log(`Failed to process modified file from the agent - ${err}`);
    state.isWaitingForUserInteraction = false; // Reset flag in case of error
  }
};
