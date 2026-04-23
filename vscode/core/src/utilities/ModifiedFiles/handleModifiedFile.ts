import {
  KaiWorkflowMessage,
  KaiWorkflowMessageType,
  KaiModifiedFile,
} from "@editor-extensions/agentic";
import { Uri } from "vscode";
import { ExtensionState } from "src/extensionState";
import { ModifiedFileState } from "@editor-extensions/shared";
import { processModifiedFile } from "./processModifiedFile";
import { routeFileChange } from "../../features/agent/fileChangeRouter";

/**
 * Handles a modified file message from the workflow.
 *
 * 1. Processes the file modification (reads original, stores in modifiedFiles map)
 * 2. Routes the file change through routeFileChange which:
 *    - Creates a diff and chat message
 *    - If batchReviewMode: queues in pendingBatchReview
 *    - If not: applies immediately via changeApplied
 */
export const handleModifiedFileMessage = async (
  msg: KaiWorkflowMessage,
  modifiedFiles: Map<string, ModifiedFileState>,
  modifiedFilesPromises: Array<Promise<void>>,
  _processedTokens: Set<string>,
  state: ExtensionState,
  eventEmitter?: { emit: (event: string, ...args: any[]) => void },
) => {
  if (msg.type !== KaiWorkflowMessageType.ModifiedFile) {
    return;
  }

  const fileData = msg.data as KaiModifiedFile;
  const { path: filePath, content } = fileData;

  modifiedFilesPromises.push(processModifiedFile(modifiedFiles, fileData, eventEmitter));

  try {
    await Promise.all(modifiedFilesPromises);

    const fileState = modifiedFiles.get(Uri.file(filePath).fsPath);
    const originalContent = fileState?.originalContent ?? fileData.originalContent;

    await routeFileChange(state, filePath, content, originalContent, true);
  } catch (err) {
    state.logger
      .child({ component: "handleModifiedFileMessage" })
      .error(`Error processing modified file ${filePath}:`, err);

    if (eventEmitter) {
      eventEmitter.emit("modifiedFileError", { filePath, error: err });
    }
  }
};
