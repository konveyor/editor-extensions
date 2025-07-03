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
 * Creates a new file with the specified content, handling errors and notifying the user via chat messages.
 * @param uri The URI of the file to create.
 * @param filePath The path of the file for logging and error messages.
 * @param content The content to write to the file.
 * @param state The extension state to mutate for chat message notifications.
 */
const createNewFile = async (
  uri: Uri,
  filePath: string,
  content: string,
  state: ExtensionState,
): Promise<void> => {
  try {
    console.log(`Creating new file at ${filePath} with content: ${content}`);
    vscode.workspace.fs.writeFile(uri, Buffer.from(content));
  } catch (fileCreationError) {
    console.error(`Failed to create file at ${filePath}:`, fileCreationError);
    // Optionally notify user of failure in chat
    const errorMessage =
      fileCreationError instanceof Error ? fileCreationError.message : String(fileCreationError);
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
};

/**
 * Deletes a file if it exists, handling errors and notifying the user via chat messages.
 * @param uri The URI of the file to delete.
 * @param filePath The path of the file for logging and error messages.
 * @param state The extension state to mutate for chat message notifications.
 */
const deleteFileIfExists = async (
  uri: Uri,
  filePath: string,
  state: ExtensionState,
): Promise<void> => {
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
      fileDeletionError instanceof Error ? fileDeletionError.message : String(fileDeletionError);
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
};

/**
 * Updates an existing file with the specified content, handling errors and notifying the user via chat messages.
 * @param uri The URI of the file to update.
 * @param filePath The path of the file for logging and error messages.
 * @param content The content to write to the file.
 * @param state The extension state to mutate for chat message notifications.
 */
const updateExistingFile = async (
  uri: Uri,
  filePath: string,
  content: string,
  state: ExtensionState,
): Promise<void> => {
  try {
    console.log(`Updating file at ${filePath}`);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
  } catch (fileUpdateError) {
    console.error(`Failed to update file at ${filePath}:`, fileUpdateError);
    // Notify user of failure in chat
    const errorMessage =
      fileUpdateError instanceof Error ? fileUpdateError.message : String(fileUpdateError);
    state.mutateData((draft) => {
      draft.chatMessages.push({
        kind: ChatMessageType.String,
        messageToken: `file-update-error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        value: {
          message: `Failed to update file at ${filePath}: ${errorMessage}`,
        },
      });
    });
  }
};

/**
 * Creates a diff for UI display based on the file state and path.
 * @param fileState The state of the modified file.
 * @param filePath The path of the file for diff creation.
 * @returns The diff string for UI display.
 */
const createFileDiff = (fileState: ModifiedFileState, filePath: string): string => {
  const isNew = fileState.originalContent === undefined;
  const isDeleted = !isNew && fileState.modifiedContent.trim() === "";
  let diff: string;

  if (isNew) {
    diff = createTwoFilesPatch("", filePath, "", fileState.modifiedContent);
  } else if (isDeleted) {
    diff = createTwoFilesPatch(filePath, "", fileState.originalContent as string, "");
  } else {
    try {
      diff = createPatch(filePath, fileState.originalContent as string, fileState.modifiedContent);
    } catch (diffErr) {
      diff = `// Error creating diff for ${filePath}`;
    }
  }
  return diff;
};

/**
 * Handles user response to file modification, updating file state accordingly.
 * @param response The user's response to the modification.
 * @param uri The URI of the file.
 * @param filePath The path of the file.
 * @param fileState The state of the modified file.
 * @param state The extension state.
 * @param isNew Whether the file is new.
 * @param isDeleted Whether the file is deleted.
 */
const handleUserResponse = async (
  response: any,
  uri: Uri,
  filePath: string,
  fileState: ModifiedFileState,
  state: ExtensionState,
  isNew: boolean,
  isDeleted: boolean,
): Promise<void> => {
  if (response.action === "apply") {
    if (isNew) {
      await createNewFile(uri, filePath, fileState.modifiedContent, state);
    } else if (isDeleted) {
      await deleteFileIfExists(uri, filePath, state);
    } else {
      await updateExistingFile(uri, filePath, fileState.modifiedContent, state);
    }
  }
};

/**
 * Processes queued messages after user interaction.
 * @param messageQueue The queue of messages to process.
 * @param state The extension state.
 * @param modifiedFilesPromises Array of promises for modified files processing.
 * @param processedTokens Set of processed message tokens.
 * @param pendingInteractions Map of pending user interactions.
 * @returns A promise that resolves when processing is complete.
 */
const processQueuedMessages = async (
  messageQueue: KaiWorkflowMessage[],
  state: ExtensionState,
  modifiedFilesPromises: Array<Promise<void>>,
  processedTokens: Set<string>,
  pendingInteractions: Map<string, (response: any) => void>,
): Promise<void> => {
  const queuedMessages = [...messageQueue];
  messageQueue.length = 0;

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
  }
};

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
      const diff = createFileDiff(fileState, filePath);

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
        pendingInteractions.set(msg.id, async (response: any) => {
          state.isWaitingForUserInteraction = false;

          // Handle user response to file modification
          await handleUserResponse(response, uri, filePath, fileState, state, isNew, isDeleted);

          // Process queued messages
          await processQueuedMessages(
            messageQueue,
            state,
            modifiedFilesPromises,
            processedTokens,
            pendingInteractions,
          );

          // Remove the entry from pendingInteractions to prevent memory leaks
          pendingInteractions.delete(msg.id);

          resolve();
        });
      });
    }
  } catch (err) {
    state.isWaitingForUserInteraction = false; // Reset flag in case of error
  }
};
