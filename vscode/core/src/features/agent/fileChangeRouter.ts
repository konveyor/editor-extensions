import { v4 as uuidv4 } from "uuid";
import { createTwoFilesPatch, createPatch } from "diff";
import {
  ChatMessageType,
  cleanDiff,
  type ModifiedFileMessageValue,
  type PendingBatchReviewFile,
} from "@editor-extensions/shared";
import type { ExtensionState } from "../../extensionState";
import { executeExtensionCommand } from "../../commands";

/**
 * Normalizes a file path relative to the workspace root.
 */
function normalizeFilePath(filePath: string, workspaceRoot: string): string {
  const wsRoot = workspaceRoot.startsWith("file://")
    ? new URL(workspaceRoot).pathname
    : workspaceRoot;

  if (filePath.startsWith(wsRoot)) {
    return filePath.slice(wsRoot.length).replace(/^\//, "");
  }
  return filePath;
}

/**
 * Central routing function for file changes from any agent backend.
 *
 * When `isBatchReviewMode` is enabled (or `forceReview` is true),
 * file changes are queued in `pendingBatchReview` for the user to
 * accept/reject. When disabled, changes are applied immediately and
 * the solution server is notified.
 *
 * The workflow path (KaiInteractiveWorkflow) always passes
 * `forceReview: true` so changes are never auto-applied from LLM output.
 *
 * In batch review mode, only the `pendingBatchReview` queue is updated
 * (the `CompactBatchReview` widget handles the UI). Otherwise a
 * `ChatMessageType.ModifiedFile` message is pushed to `chatMessages`.
 */
export async function routeFileChange(
  state: ExtensionState,
  filePath: string,
  content: string,
  originalContent?: string,
  forceReview = false,
): Promise<void> {
  const isBatchReviewMode = forceReview || state.data.isBatchReviewMode === true;
  const relativePath = normalizeFilePath(filePath, state.data.workspaceRoot);

  if (isBatchReviewMode) {
    const alreadyPending = state.data.pendingBatchReview?.some(
      (f) => normalizeFilePath(f.path, state.data.workspaceRoot) === relativePath,
    );
    if (alreadyPending) {
      return;
    }
  }

  let diff = "";
  let isNew = false;
  const isDeleted = false;

  const patchOptions = { ignoreNewlineAtEof: true } as Parameters<typeof createPatch>[5];

  try {
    if (!originalContent) {
      isNew = true;
      const rawDiff = createTwoFilesPatch(
        "",
        relativePath,
        "",
        content,
        undefined,
        undefined,
        patchOptions,
      );
      diff = cleanDiff(rawDiff);
    } else {
      const rawDiff = createTwoFilesPatch(
        relativePath,
        relativePath,
        originalContent,
        content,
        undefined,
        undefined,
        patchOptions,
      );
      diff = cleanDiff(rawDiff);
    }
  } catch {
    diff = content;
  }

  const messageToken = uuidv4();

  const fileValue: ModifiedFileMessageValue = {
    path: relativePath,
    content,
    originalContent,
    isNew,
    isDeleted,
    diff,
    readOnly: isBatchReviewMode,
  };

  if (isBatchReviewMode) {
    const reviewFile: PendingBatchReviewFile = {
      messageToken,
      path: relativePath,
      diff,
      content,
      originalContent,
      isNew,
      isDeleted,
    };

    state.mutate((draft) => {
      if (!draft.pendingBatchReview) {
        draft.pendingBatchReview = [];
      }
      draft.pendingBatchReview.push(reviewFile);
    });
  } else {
    state.mutate((draft) => {
      draft.chatMessages.push({
        kind: ChatMessageType.ModifiedFile,
        messageToken,
        timestamp: new Date().toISOString(),
        value: fileValue,
      });
    });

    Promise.resolve(executeExtensionCommand("changeApplied", filePath, content)).catch(() => {});
  }
}
