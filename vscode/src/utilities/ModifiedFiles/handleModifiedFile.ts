import {
  KaiWorkflowMessage,
  KaiWorkflowMessageType,
  KaiModifiedFile,
} from "@editor-extensions/agentic";
import { createTwoFilesPatch, createPatch } from "diff";
import { ExtensionState } from "src/extensionState";
import { Uri } from "vscode";
import { ModifiedFileState, ChatMessageType } from "@editor-extensions/shared";
// Import path module for platform-agnostic path handling
import { processModifiedFile } from "./processModifiedFile";
import { MessageQueueManager, handleUserInteractionComplete } from "./queueManager";

/**
 * Performs comprehensive cleanup of resources and state variables when an error occurs
 * during file processing. This ensures the system returns to a consistent state.
 */
export const cleanupOnError = (
  filePath: string,
  msgId: string,
  state: ExtensionState,
  modifiedFiles: Map<string, ModifiedFileState>,
  pendingInteractions: Map<string, (response: any) => void>,
  processedTokens: Set<string>,
  modifiedFilesPromises: Array<Promise<void>>,
  eventEmitter?: { emit: (event: string, ...args: any[]) => void },
  error?: any,
) => {
  // Reset the waiting flag
  state.mutateData((draft) => {
    draft.isWaitingForUserInteraction = false;
  });

  // Clean up pending interactions to prevent memory leaks
  if (pendingInteractions.has(msgId)) {
    pendingInteractions.delete(msgId);
  }

  // Remove any partially processed file state from modifiedFiles map
  const uri = Uri.file(filePath);
  if (modifiedFiles.has(uri.fsPath)) {
    modifiedFiles.delete(uri.fsPath);
  }

  // Remove the processed token if it was added
  if (processedTokens.has(msgId)) {
    processedTokens.delete(msgId);
  }

  // Clear any promises that might be stuck in the array
  // Since we can't easily identify which promises are related to this specific file,
  // we'll clear all promises that haven't been resolved yet
  // This is a conservative approach to prevent stuck promises
  modifiedFilesPromises.length = 0;

  // Emit cleanup event if eventEmitter is available
  if (eventEmitter) {
    eventEmitter.emit("modifiedFileError", { filePath, error });
  }
};

/**
 * Creates a diff for UI display based on the file state and path.
 * @param fileState The state of the modified file.
 * @param filePath The path of the file for diff creation.
 * @returns The diff string for UI display.
 */
const createFileDiff = (fileState: ModifiedFileState, filePath: string): string => {
  // Note: Use path module for any directory path extraction to ensure platform independence.
  // For example, use path.dirname(filePath) instead of string manipulation with lastIndexOf.
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
  state: ExtensionState,
  queueManager: MessageQueueManager,
  eventEmitter?: { emit: (event: string, ...args: any[]) => void },
) => {
  // Ensure we're dealing with a ModifiedFile message
  if (msg.type !== KaiWorkflowMessageType.ModifiedFile) {
    return;
  }

  // Get file info for UI display
  const { path: filePath } = msg.data as KaiModifiedFile;

  // Process the modified file and store it in the modifiedFiles map
  modifiedFilesPromises.push(
    processModifiedFile(modifiedFiles, msg.data as KaiModifiedFile, eventEmitter),
  );

  const uri = Uri.file(filePath);

  try {
    // Wait for the file to be processed
    await Promise.all(modifiedFilesPromises);

    // Get file state from modifiedFiles map
    const fileState = modifiedFiles.get(uri.fsPath);
    if (fileState) {
      // Use unified logic for both agent and non-agent modes to enable decorator flow
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
            originalContent: fileState.originalContent, // Use from ModifiedFileState
            isNew: isNew,
            isDeleted: isDeleted,
            diff: diff,
            messageToken: msg.id, // Add message token to value for reference
            userInteraction: msg.data.userInteraction,
          },
          quickResponses: [
            { id: "apply", content: "Apply" },
            { id: "reject", content: "Reject" },
          ],
        });
      });

      state.mutateData((draft) => {
        draft.isWaitingForUserInteraction = true;
      });

      // Set up the pending interaction using the same mechanism as UserInteraction messages
      // This ensures that handleFileResponse can properly trigger queue processing
      await new Promise<void>((resolve) => {
        pendingInteractions.set(msg.id, async (response: any) => {
          try {
            // Use the centralized interaction completion handler
            await handleUserInteractionComplete(state, queueManager);

            // Remove the entry from pendingInteractions to prevent memory leaks
            pendingInteractions.delete(msg.id);
            resolve();
          } catch (error) {
            console.error(`Error in ModifiedFile resolver for messageId: ${msg.id}:`, error);
            // Remove the entry from pendingInteractions to prevent memory leaks
            pendingInteractions.delete(msg.id);
            resolve();
          }
        });
      });
    }
  } catch (err) {
    console.error(`Error in handleModifiedFileMessage for ${filePath}:`, err);

    // Comprehensive cleanup of all resources and state variables
    // This ensures the system returns to a consistent state after an error
    try {
      cleanupOnError(
        filePath,
        msg.id,
        state,
        modifiedFiles,
        pendingInteractions,
        processedTokens,
        modifiedFilesPromises,
        eventEmitter,
        err,
      );
    } catch (cleanupError) {
      console.error(`Error during cleanup for ${filePath}:`, cleanupError);
      // Even if cleanup fails, ensure the waiting flag is reset
      state.mutateData((draft) => {
        draft.isWaitingForUserInteraction = false;
      });
    }
  }
};
