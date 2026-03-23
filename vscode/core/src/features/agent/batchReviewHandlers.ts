import * as vscode from "vscode";
import type { ExtensionState } from "../../extensionState";
import type winston from "winston";
import { handleFileResponse } from "../../utilities/ModifiedFiles/handleFileResponse";
import { runPartialAnalysis } from "../../analysis/runAnalysis";

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
    await handleFileResponse(messageToken, responseId, path, content, state);

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
      const uri = vscode.Uri.file(path);
      const currentBytes = await vscode.workspace.fs.readFile(uri);
      const currentText = new TextDecoder().decode(currentBytes);

      const fileState = state.modifiedFiles.get(uri.fsPath);
      const originalContent = fileState?.originalContent ?? content;

      const normalize = (s: string) => s.replace(/\r\n/g, "\n").trim();
      const hasChanges = normalize(currentText) !== normalize(originalContent);
      const responseId = hasChanges ? "apply" : "reject";
      const finalContent = hasChanges ? currentText : content;

      await handleFileResponse(messageToken, responseId, path, finalContent, state, true);

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
      await handleFileResponse(messageToken, "reject", path, content, state, true);

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

      state.mutate((draft) => {
        draft.isProcessingQueuedMessages = true;
      });

      for (const file of files) {
        try {
          await handleFileResponse(
            file.messageToken,
            "apply",
            file.path,
            file.content,
            state,
            true,
          );

          appliedFileUris.push(vscode.Uri.file(file.path));

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
      state.mutate((draft) => {
        draft.isProcessingQueuedMessages = false;
      });
    }
  },

  BATCH_REJECT_ALL: async ({ files }, state, logger) => {
    const failures: Array<{ path: string; error: string }> = [];

    try {
      logger.info(`BATCH_REJECT_ALL: Rejecting ${files.length} files`);

      state.mutate((draft) => {
        draft.isProcessingQueuedMessages = true;
      });

      for (const file of files) {
        try {
          await handleFileResponse(file.messageToken, "reject", file.path, undefined, state);

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
      state.mutate((draft) => {
        draft.isProcessingQueuedMessages = false;
      });
    }
  },
};

function checkBatchReviewComplete(state: ExtensionState, logger: winston.Logger): void {
  const hasPending = state.data.pendingBatchReview && state.data.pendingBatchReview.length > 0;

  if (!hasPending) {
    logger.info("Batch review complete");
    state.mutate((draft) => {
      draft.pendingBatchReview = [];
    });
  }
}
