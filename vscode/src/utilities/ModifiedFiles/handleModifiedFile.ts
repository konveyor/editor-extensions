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
import { getConfigAgentMode } from "../configuration";

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
  messageQueue: KaiWorkflowMessage[],
  state: ExtensionState,
  queueManager?: MessageQueueManager,
  eventEmitter?: { emit: (event: string, ...args: any[]) => void },
) => {
  // Ensure we're dealing with a ModifiedFile message
  if (msg.type !== KaiWorkflowMessageType.ModifiedFile) {
    return;
  }

  // Get file info for UI display
  const { path: filePath } = msg.data as KaiModifiedFile;
  const isAgentMode = getConfigAgentMode();

  console.log(`handleModifiedFileMessage: ${filePath}, agentMode: ${isAgentMode}`);

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
      console.log(`File state created for ${filePath}, modifiedFiles size: ${modifiedFiles.size}`);

      if (isAgentMode) {
        // In agentic mode: Add chat message and wait for user interaction
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
            // Use the new queue manager if available, otherwise fall back to old behavior
            if (queueManager) {
              await handleUserInteractionComplete(state, queueManager);
            } else {
              // Fallback to old behavior for backward compatibility
              state.isWaitingForUserInteraction = false;
              // Note: Old processQueuedMessages function was removed,
              // so this fallback won't process queued messages
              console.warn("Queue manager not available, queued messages may not be processed");
            }

            // Remove the entry from pendingInteractions to prevent memory leaks
            pendingInteractions.delete(msg.id);

            resolve();
          });
        });
      } else {
        // In non-agentic mode: Just store the file state, no chat interaction
        console.log(`Non-agentic mode: File ${filePath} processed and stored in modifiedFiles`);
        // The file is already stored in modifiedFiles by processModifiedFile
        // No chat message or user interaction needed
      }
    }
  } catch (err) {
    console.error(`Error in handleModifiedFileMessage for ${filePath}:`, err);
    state.isWaitingForUserInteraction = false; // Reset flag in case of error
  }
};
