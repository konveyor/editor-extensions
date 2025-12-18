/**
 * Solution Workflow Domain Actions
 *
 * All AI solution generation operations: workflow lifecycle, batch review, processing state
 */

import type { Scope, PendingBatchReviewFile } from "@editor-extensions/shared";
import type { StateCreator } from "zustand";
import type { ExtensionStore } from "../extensionStore";

/**
 * Solution workflow domain action types
 */
export interface SolutionWorkflowDomainActions {
  /**
   * Solution workflow domain
   * All AI solution generation operations
   */
  solutionWorkflow: {
    /**
     * Start solution workflow for given scope
     */
    start: (scope: Scope) => void;

    /**
     * Wait for user interaction (pause workflow)
     */
    waitForUserInteraction: () => void;

    /**
     * Resume workflow after user interaction
     */
    resumeAfterInteraction: () => void;

    /**
     * Complete workflow with given state
     */
    complete: (state: "success" | "cancelled" | "failed") => void;

    /**
     * Reset workflow to initial state
     */
    reset: () => void;

    /**
     * Batch review management
     */
    batchReview: {
      /**
       * Begin batch review with files
       */
      begin: (files: PendingBatchReviewFile[]) => void;

      /**
       * Update a specific file in batch review
       */
      updateFile: (messageToken: string, updates: Partial<PendingBatchReviewFile>) => void;

      /**
       * Remove a file from batch review
       */
      removeFile: (messageToken: string) => void;

      /**
       * Complete batch review (clear all files)
       */
      complete: () => void;
    };

    /**
     * Queue processing state
     */
    queue: {
      /**
       * Begin processing queued messages
       */
      beginProcessing: () => void;

      /**
       * Complete processing queued messages
       */
      completeProcessing: () => void;
    };
  };
}

/**
 * Create Solution Workflow domain actions
 * This slice focuses on AI solution generation business logic
 */
export const createSolutionWorkflowActions: StateCreator<
  ExtensionStore,
  [["zustand/subscribeWithSelector", never], ["zustand/immer", never]],
  [],
  SolutionWorkflowDomainActions
> = (set) => ({
  solutionWorkflow: {
    start: (scope) =>
      set((state) => {
        state.isFetchingSolution = true;
        state.solutionState = "started";
        state.solutionScope = scope;
        state.isWaitingForUserInteraction = false;
      }),

    waitForUserInteraction: () =>
      set((state) => {
        state.isWaitingForUserInteraction = true;
      }),

    resumeAfterInteraction: () =>
      set((state) => {
        state.isWaitingForUserInteraction = false;
      }),

    complete: (completionState) =>
      set((state) => {
        state.isFetchingSolution = false;
        state.isWaitingForUserInteraction = false;

        // Business rule: Map completion state to solution state
        switch (completionState) {
          case "success":
            state.solutionState = "received"; // Success means we received the solution
            break;
          case "cancelled":
            state.solutionState = "none"; // Cancelled resets to none
            break;
          case "failed":
            state.solutionState = "failedOnSending";
            break;
        }
      }),

    reset: () =>
      set((state) => {
        state.isFetchingSolution = false;
        state.solutionState = "none";
        state.solutionScope = undefined;
        state.isWaitingForUserInteraction = false;
        state.isProcessingQueuedMessages = false;
        state.pendingBatchReview = [];
      }),

    batchReview: {
      begin: (files) =>
        set((state) => {
          state.pendingBatchReview = files;
        }),

      updateFile: (messageToken, updates) =>
        set((state) => {
          const index = state.pendingBatchReview.findIndex((f) => f.messageToken === messageToken);
          if (index !== -1) {
            state.pendingBatchReview[index] = {
              ...state.pendingBatchReview[index],
              ...updates,
            };
          }
        }),

      removeFile: (messageToken) =>
        set((state) => {
          state.pendingBatchReview = state.pendingBatchReview.filter(
            (f) => f.messageToken !== messageToken,
          );
        }),

      complete: () =>
        set((state) => {
          state.pendingBatchReview = [];
        }),
    },

    queue: {
      beginProcessing: () =>
        set((state) => {
          state.isProcessingQueuedMessages = true;
        }),

      completeProcessing: () =>
        set((state) => {
          state.isProcessingQueuedMessages = false;
        }),
    },
  },
});
