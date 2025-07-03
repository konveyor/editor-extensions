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
import * as vscode from "vscode";

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
      const isDeleted = !isNew && fileState.modifiedContent.trim() === "";
      let diff: string;

      if (isNew) {
        diff = createTwoFilesPatch("", filePath, "", fileState.modifiedContent);
      } else if (isDeleted) {
        diff = createTwoFilesPatch(filePath, "", fileState.originalContent as string, "");
      } else {
        try {
          diff = createPatch(
            filePath,
            fileState.originalContent as string,
            fileState.modifiedContent,
          );
        } catch (diffErr) {
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
            isDeleted: isDeleted,
            diff: diff,
            messageToken: msg.id, // Add message token to value for reference
          },
          quickResponses: [
            { id: "apply", content: "Apply" },
            { id: "reject", content: "Reject" },
          ],
        });
      });

      state.isWaitingForUserInteraction = true;

      await new Promise<void>((resolve) => {
        pendingInteractions.set(msg.id, (response: any) => {
          state.isWaitingForUserInteraction = false;

          // If the user accepts the changes, handle file creation or deletion
          if (response === "apply") {
            if (isNew) {
              try {
                console.log(
                  `Creating new file at ${filePath} with content: ${fileState.modifiedContent}`,
                );
                vscode.workspace.fs.writeFile(uri, Buffer.from(fileState.modifiedContent));
              } catch (fileCreationError) {
                console.error(`Failed to create file at ${filePath}:`, fileCreationError);
                // Optionally notify user of failure in chat
                const errorMessage =
                  fileCreationError instanceof Error
                    ? fileCreationError.message
                    : String(fileCreationError);
                state.mutateData((draft) => {
                  draft.chatMessages.push({
                    kind: ChatMessageType.String,
                    messageToken: `file-creation-error-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    value: {
                      message: `Failed to create file at ${filePath}: ${errorMessage}`,
                    },
                  });
                });
              }
            } else if (isDeleted) {
              (async () => {
                try {
                  // Check if the file exists before attempting to delete
                  const fileExists = await vscode.workspace.fs.stat(uri).then(
                    () => true,
                    () => false,
                  );
                  if (fileExists) {
                    console.log(`Deleting file at ${filePath}`);
                    await vscode.workspace.fs.delete(uri);
                  } else {
                    console.log(`File at ${filePath} does not exist, skipping deletion.`);
                    state.mutateData((draft) => {
                      draft.chatMessages.push({
                        kind: ChatMessageType.String,
                        messageToken: `file-not-found-${Date.now()}`,
                        timestamp: new Date().toISOString(),
                        value: {
                          message: `File at ${filePath} does not exist, skipping deletion.`,
                        },
                      });
                    });
                  }
                } catch (fileDeletionError) {
                  console.error(`Failed to delete file at ${filePath}:`, fileDeletionError);
                  // Optionally notify user of failure in chat
                  const errorMessage =
                    fileDeletionError instanceof Error
                      ? fileDeletionError.message
                      : String(fileDeletionError);
                  state.mutateData((draft) => {
                    draft.chatMessages.push({
                      kind: ChatMessageType.String,
                      messageToken: `file-deletion-error-${Date.now()}`,
                      timestamp: new Date().toISOString(),
                      value: {
                        message: `Failed to delete file at ${filePath}: ${errorMessage}`,
                      },
                    });
                  });
                }
              })();
            }
          }

          const queuedMessages = [...messageQueue];
          messageQueue.length = 0;

          (async () => {
            try {
              const uniqueQueuedMessages = queuedMessages.filter((msg, index, self) => {
                if (msg.type === KaiWorkflowMessageType.ModifiedFile) {
                  const filePath = (msg.data as KaiModifiedFile).path;
                  return (
                    self.findLastIndex(
                      (m) =>
                        m.type === KaiWorkflowMessageType.ModifiedFile &&
                        (m.data as KaiModifiedFile).path === filePath,
                    ) === index
                  );
                }
                return self.findIndex((m) => m.id === msg.id) === index;
              });

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
    state.isWaitingForUserInteraction = false; // Reset flag in case of error
  }
};
