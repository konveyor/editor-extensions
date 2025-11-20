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
    } catch {
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
 * With batch review, this now simply:
 * 1. Processes the file modification
 * 2. Creates a diff for UI display
 * 3. Adds a read-only message to chat for context
 * 4. Accumulates the file in pendingBatchReview for later review
 *
 * No longer blocks the queue or creates pending interactions
 */
export const handleModifiedFileMessage = async (
  msg: KaiWorkflowMessage,
  modifiedFiles: Map<string, ModifiedFileState>,
  modifiedFilesPromises: Array<Promise<void>>,
  processedTokens: Set<string>,
  state: ExtensionState,
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
      const isNew = fileState.originalContent === undefined;
      const isDeleted = !isNew && fileState.modifiedContent.trim() === "";
      const diff = createFileDiff(fileState, filePath);

      // Part 1: Add read-only diff to chat for context
      state.mutateChatMessages((draft) => {
        draft.chatMessages.push({
          kind: ChatMessageType.ModifiedFile,
          messageToken: msg.id,
          timestamp: new Date().toISOString(),
          value: {
            path: filePath,
            content: fileState.modifiedContent,
            originalContent: fileState.originalContent,
            isNew: isNew,
            isDeleted: isDeleted,
            diff: diff,
            messageToken: msg.id,
            userInteraction: msg.data.userInteraction,
            readOnly: true, // Always read-only - actions happen in BatchReviewModal
          },
        });
      });

      // Part 2: Accumulate for batch review at the end
      state.mutateSolutionWorkflow((draft) => {
        if (!draft.pendingBatchReview) {
          draft.pendingBatchReview = [];
        }
        draft.pendingBatchReview.push({
          messageToken: msg.id,
          path: filePath,
          diff: diff,
          content: fileState.modifiedContent,
          originalContent: fileState.originalContent,
          isNew: isNew,
          isDeleted: isDeleted,
        });
      });
    }
  } catch (err) {
    // Log error but don't need complex cleanup since we're not blocking the queue
    state.logger
      .child({ component: "handleModifiedFileMessage" })
      .error(`Error processing modified file ${filePath}:`, err);

    // Emit error event if eventEmitter is available
    if (eventEmitter) {
      eventEmitter.emit("modifiedFileError", { filePath, error: err });
    }
  }
};
