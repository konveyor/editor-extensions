import * as vscode from "vscode";
import * as path from "path";
import { ChatMessageType, cleanDiff } from "@editor-extensions/shared";
import type { ExtensionState } from "../../extensionState";

/**
 * Normalize a path that may arrive as a file: URI, file:// URI, or absolute path.
 */
export function normalizeFilePath(filePath: string, workspaceRoot?: string): string {
  let normalized = filePath;
  if (normalized.startsWith("file://")) {
    normalized = new URL(normalized).pathname;
  } else if (normalized.startsWith("file:")) {
    normalized = normalized.slice("file:".length);
  }
  if (workspaceRoot && !path.isAbsolute(normalized)) {
    normalized = path.join(workspaceRoot, normalized);
  }
  return normalized;
}

/**
 * Route a file change through processModifiedFile -> diff -> chat message -> batch review.
 * Single entry point for all Goose file changes (MCP bridge + post-scan fallback).
 */
export async function routeFileChangeToBatchReview(
  state: ExtensionState,
  absPath: string,
  content: string,
  originalContent?: string,
): Promise<void> {
  absPath = normalizeFilePath(absPath, state.data.workspaceRoot);

  const logger = state.logger.child({ component: "routeFileChangeToBatchReview" });

  logger.info("Routing file change to batch review", {
    absPath,
    contentLength: content.length,
    hasOriginalContent: originalContent !== undefined,
    originalContentLength: originalContent?.length,
    contentEqualsOriginal: originalContent !== undefined && content === originalContent,
  });

  const { processModifiedFile } = await import("../../utilities/ModifiedFiles/processModifiedFile");
  const { createTwoFilesPatch, createPatch } = await import("diff");
  const { v4: uuidv4 } = await import("uuid");

  if (originalContent === undefined) {
    logger.info(
      "Skipping batch review entry — no originalContent available, post-scan will handle",
      { absPath },
    );
    return;
  }

  const fsPath = vscode.Uri.file(absPath).fsPath;
  if (state.data.pendingBatchReview?.some((f) => f.path === absPath || f.path === fsPath)) {
    logger.info("Skipping duplicate file already in pendingBatchReview", { absPath });
    return;
  }

  const messageId = uuidv4();

  await processModifiedFile(
    state.modifiedFiles,
    { path: absPath, content, originalContent },
    state.modifiedFilesEventEmitter,
  );

  const fileState = state.modifiedFiles.get(vscode.Uri.file(absPath).fsPath);
  if (!fileState) {
    logger.warn("processModifiedFile did not create state for file", { absPath, fsPath });
    return;
  }

  const isNew = fileState.originalContent === undefined;
  const isDeleted = !isNew && fileState.modifiedContent.trim() === "";

  logger.info("File state after processModifiedFile", {
    absPath,
    isNew,
    isDeleted,
    modifiedContentLength: fileState.modifiedContent.length,
    originalContentLength: fileState.originalContent?.length,
    contentsMatch: fileState.originalContent === fileState.modifiedContent,
  });

  let diff: string;
  if (isNew) {
    diff = createTwoFilesPatch("", absPath, "", fileState.modifiedContent);
  } else if (isDeleted) {
    diff = createTwoFilesPatch(absPath, "", fileState.originalContent as string, "");
  } else {
    try {
      diff = createPatch(absPath, fileState.originalContent as string, fileState.modifiedContent);
    } catch {
      diff = `// Error creating diff for ${absPath}`;
    }
  }

  const rawDiffLength = diff.length;
  diff = cleanDiff(diff);

  logger.info("Diff result", {
    absPath,
    rawDiffLength,
    cleanedDiffLength: diff.length,
    diffEmpty: diff.trim() === "",
  });

  state.mutate((draft) => {
    draft.chatMessages.push({
      kind: ChatMessageType.ModifiedFile,
      messageToken: messageId,
      timestamp: new Date().toISOString(),
      value: {
        path: absPath,
        content: fileState.modifiedContent,
        originalContent: fileState.originalContent,
        isNew,
        isDeleted,
        diff,
        messageToken: messageId,
        readOnly: true,
      },
    });
  });

  state.mutate((draft) => {
    if (!draft.pendingBatchReview) {
      draft.pendingBatchReview = [];
    }
    draft.pendingBatchReview.push({
      messageToken: messageId,
      path: absPath,
      diff,
      content: fileState.modifiedContent,
      originalContent: fileState.originalContent,
      isNew,
      isDeleted,
    });
  });
}
