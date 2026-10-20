import * as vscode from "vscode";
import { join, isAbsolute } from "path";
import { fileURLToPath } from "url";
import type { ExtensionState } from "../../extensionState";
import type winston from "winston";
import { MessageTypes } from "@editor-extensions/shared";
import { handleFileResponse } from "../../utilities/ModifiedFiles/handleFileResponse";
import { runPartialAnalysis } from "../../analysis/runAnalysis";
import { decideContinueOutcome, resolveContinueBaseline } from "./continueOutcome";

/**
 * Tell every webview that a batch apply/reject has finished so it can
 * re-enable its controls. Entries that failed stay in `pendingBatchReview`
 * (with `hasError`) for a retry, so the webview cannot rely on the queue
 * emptying to detect completion.
 */
function notifyBatchOperationComplete(state: ExtensionState, failedCount: number): void {
  const timestamp = new Date().toISOString();
  for (const provider of state.webviewProviders.values()) {
    provider.sendMessageToWebview({
      type: MessageTypes.BATCH_OPERATION_COMPLETE,
      failedCount,
      timestamp,
    });
  }
}

/**
 * Resolve a potentially relative path against the workspace root.
 * Paths stored in `pendingBatchReview` are relative but `handleFileResponse`
 * and VS Code file APIs need absolute paths.
 */
function resolveAbsolutePath(filePath: string, state: ExtensionState): string {
  if (isAbsolute(filePath)) {
    return filePath;
  }
  let wsRoot = state.data.workspaceRoot;
  if (wsRoot.startsWith("file://")) {
    wsRoot = fileURLToPath(wsRoot);
  }
  return join(wsRoot, filePath);
}

/**
 * Message handlers for batch review operations.
 *
 * These handle accept/reject actions from the CompactBatchReview UI component
 * and manage the `pendingBatchReview` queue in extension state.
 */
export const batchReviewHandlers: Record<
  string,
  (payload: any, state: ExtensionState, logger: winston.Logger) => void | Promise<void>
> = {
  FILE_RESPONSE: async ({ responseId, messageToken, path, content }, state, logger) => {
    const absPath = resolveAbsolutePath(path, state);
    await handleFileResponse(messageToken, responseId, absPath, content, state);

    state.mutate((draft) => {
      if (draft.pendingBatchReview) {
        draft.pendingBatchReview = draft.pendingBatchReview.filter(
          (file) => file.messageToken !== messageToken,
        );
        logger.info(`Removed file from pendingBatchReview: ${path}`, {
          remaining: draft.pendingBatchReview.length,
        });
      }
    });

    checkBatchReviewComplete(state, logger);
  },

  CONTINUE_WITH_FILE_STATE: async ({ path, messageToken, content }, state, logger) => {
    try {
      const absPath = resolveAbsolutePath(path, state);
      const uri = vscode.Uri.file(absPath);
      const currentBytes = await vscode.workspace.fs.readFile(uri);
      const currentText = new TextDecoder().decode(currentBytes);

      // The proposal's own queue entry carries the pre-change content; the
      // agent route does not populate state.modifiedFiles. Falling back to
      // the proposal (`content`) made an untouched file look edited, so
      // Continue reported the original as an accepted change.
      const queued = state.data.pendingBatchReview?.find((f) => f.messageToken === messageToken);
      const originalContent = resolveContinueBaseline(
        queued,
        state.modifiedFiles.get(uri.fsPath)?.originalContent,
      );
      if (originalContent === undefined) {
        // Without a baseline we cannot tell whether the user kept anything;
        // keep the proposal queued (flagged, which also releases the
        // webview's busy state for it) rather than guess an outcome.
        logger.warn("CONTINUE_WITH_FILE_STATE: no original content; keeping proposal queued", {
          path,
          messageToken,
        });
        state.mutate((draft) => {
          const entry = draft.pendingBatchReview?.find((f) => f.messageToken === messageToken);
          if (entry) {
            entry.hasError = true;
          }
        });
        return;
      }

      const outcome = decideContinueOutcome(currentText, originalContent, content);

      await handleFileResponse(
        messageToken,
        outcome.responseId,
        absPath,
        outcome.content,
        state,
        true,
      );

      state.mutate((draft) => {
        if (draft.pendingBatchReview) {
          draft.pendingBatchReview = draft.pendingBatchReview.filter(
            (file) => file.messageToken !== messageToken,
          );
        }
      });

      checkBatchReviewComplete(state, logger);
    } catch (error) {
      logger.error("Error handling CONTINUE_WITH_FILE_STATE:", error);
      const absPath = resolveAbsolutePath(path, state);
      await handleFileResponse(messageToken, "reject", absPath, content, state, true);

      state.mutate((draft) => {
        if (draft.pendingBatchReview) {
          draft.pendingBatchReview = draft.pendingBatchReview.filter(
            (file) => file.messageToken !== messageToken,
          );
        }
      });

      checkBatchReviewComplete(state, logger);
    }
  },

  BATCH_APPLY_ALL: async ({ files }, state, logger) => {
    const failures: Array<{ path: string; error: string }> = [];
    const appliedFileUris: vscode.Uri[] = [];

    try {
      logger.info(`BATCH_APPLY_ALL: Applying ${files.length} files`);
      clearBatchErrors(state, files);

      for (const file of files) {
        try {
          const absPath = resolveAbsolutePath(file.path, state);
          await handleFileResponse(file.messageToken, "apply", absPath, file.content, state, true);

          appliedFileUris.push(vscode.Uri.file(absPath));

          state.mutate((draft) => {
            if (draft.pendingBatchReview) {
              draft.pendingBatchReview = draft.pendingBatchReview.filter(
                (f) => f.messageToken !== file.messageToken,
              );
            }
          });
        } catch (fileError) {
          const errorMessage = fileError instanceof Error ? fileError.message : String(fileError);
          logger.error(`BATCH_APPLY_ALL: Failed to apply file ${file.path}:`, fileError);
          failures.push({ path: file.path, error: errorMessage });

          state.mutate((draft) => {
            if (draft.pendingBatchReview) {
              const fileIndex = draft.pendingBatchReview.findIndex(
                (f) => f.messageToken === file.messageToken,
              );
              if (fileIndex !== -1) {
                draft.pendingBatchReview[fileIndex].hasError = true;
              }
            }
          });
        }
      }

      if (appliedFileUris.length > 0) {
        try {
          await runPartialAnalysis(state, appliedFileUris);
        } catch (analysisError) {
          logger.warn(`BATCH_APPLY_ALL: Failed to run combined analysis:`, analysisError);
        }
      }

      if (failures.length > 0) {
        const failureDetails = failures.map((f) => `${f.path}: ${f.error}`).join("\n");
        logger.error(`BATCH_APPLY_ALL: Failures:\n${failureDetails}`);
        vscode.window.showErrorMessage(
          `Failed to apply ${failures.length} file(s). See output for details.`,
        );
      }

      checkBatchReviewComplete(state, logger);
    } catch (unexpectedError) {
      logger.error("Unexpected error in BATCH_APPLY_ALL:", unexpectedError);
      vscode.window.showErrorMessage(
        "An unexpected error occurred while applying files. Check the output for details.",
      );
    } finally {
      notifyBatchOperationComplete(state, failures.length);
    }
  },

  BATCH_REJECT_ALL: async ({ files }, state, logger) => {
    const failures: Array<{ path: string; error: string }> = [];

    try {
      logger.info(`BATCH_REJECT_ALL: Rejecting ${files.length} files`);
      clearBatchErrors(state, files);

      for (const file of files) {
        try {
          const absPath = resolveAbsolutePath(file.path, state);
          await handleFileResponse(file.messageToken, "reject", absPath, undefined, state);

          state.mutate((draft) => {
            if (draft.pendingBatchReview) {
              draft.pendingBatchReview = draft.pendingBatchReview.filter(
                (f) => f.messageToken !== file.messageToken,
              );
            }
          });
        } catch (fileError) {
          const errorMessage = fileError instanceof Error ? fileError.message : String(fileError);
          logger.error(`BATCH_REJECT_ALL: Failed to reject file ${file.path}:`, fileError);
          failures.push({ path: file.path, error: errorMessage });

          state.mutate((draft) => {
            if (draft.pendingBatchReview) {
              const fileIndex = draft.pendingBatchReview.findIndex(
                (f) => f.messageToken === file.messageToken,
              );
              if (fileIndex !== -1) {
                draft.pendingBatchReview[fileIndex].hasError = true;
              }
            }
          });
        }
      }

      if (failures.length > 0) {
        vscode.window.showErrorMessage(
          `Failed to reject ${failures.length} file(s). See output for details.`,
        );
      }

      checkBatchReviewComplete(state, logger);
    } catch (unexpectedError) {
      logger.error("Unexpected error in BATCH_REJECT_ALL:", unexpectedError);
      vscode.window.showErrorMessage(
        "An unexpected error occurred while rejecting files. Check the output for details.",
      );
    } finally {
      notifyBatchOperationComplete(state, failures.length);
    }
  },
};

/** Reset `hasError` on the files about to be retried in a batch. */
function clearBatchErrors(state: ExtensionState, files: Array<{ messageToken: string }>): void {
  const tokens = new Set(files.map((f) => f.messageToken));
  state.mutate((draft) => {
    for (const file of draft.pendingBatchReview ?? []) {
      if (file.hasError && tokens.has(file.messageToken)) {
        file.hasError = undefined;
      }
    }
  });
}

/**
 * Check if batch review is complete and, once the agent run has finished,
 * fully reset workflow state.
 *
 * Only clearing `pendingBatchReview` left the extension in a broken state
 * where analysis could not run because it thought a resolution was still in
 * progress (#1363). When the batch is done and no run is active we reset ALL
 * workflow state so the next analysis starts from a clean slate.
 *
 * Files can be routed to batch review while the agent is still streaming, so
 * if a run is in progress we only clear the pending list — the orchestrator's
 * cleanup resets the workflow flags when the run ends.
 */
function checkBatchReviewComplete(state: ExtensionState, logger: winston.Logger): void {
  const hasPending = state.data.pendingBatchReview && state.data.pendingBatchReview.length > 0;

  if (hasPending) {
    return;
  }

  if (state.data.isFetchingSolution) {
    logger.info("Batch review complete — agent run still active, deferring workflow reset");
    state.mutate((draft) => {
      draft.pendingBatchReview = [];
    });
    return;
  }

  logger.info("Batch review complete — resetting all workflow state");

  // Reset all solution workflow flags to unblock analysis
  state.mutate((draft) => {
    draft.pendingBatchReview = [];
    draft.isFetchingSolution = false;
    draft.solutionState = "none";
    draft.isAnalyzing = false;
    draft.isAnalysisScheduled = false;
  });

  // Clear the modified files cache — the batch is done, these are no longer needed
  state.modifiedFiles.clear();

  // Reset the kaiFsCache
  state.kaiFsCache.reset();

  logger.info("Workflow state fully reset — analysis is now unblocked");
}
