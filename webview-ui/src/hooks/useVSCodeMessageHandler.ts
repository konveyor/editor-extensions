import { useEffect, useRef } from "react";
import {
  WebviewMessage,
  isFullStateUpdate,
  isChatMessagesUpdate,
  isChatMessageStreamingUpdate,
  isAnalysisStateUpdate,
  isSolutionWorkflowUpdate,
  isServerStateUpdate,
  isProfilesUpdate,
  isConfigErrorsUpdate,
  isDecoratorsUpdate,
  isSettingsUpdate,
  isFocusViolation,
  ConfigErrorType,
} from "@editor-extensions/shared";
import { useExtensionStore } from "../store/store";

/**
 * Maximum number of chat messages to keep in memory.
 *
 * When this limit is reached, older messages are automatically removed
 * to maintain a rolling window of the most recent messages.
 *
 * Default: 50,000 messages (supports ~5x typical session usage of 10,000 messages)
 *
 * Memory usage estimate:
 * - Average message size: ~1KB
 * - Total memory at limit: ~50MB
 *
 * Adjust based on your application's memory constraints and usage patterns.
 */
const MAX_CHAT_MESSAGES = 50000;

// Throttle streaming updates to prevent UI death spiral
// Updates will batch until this interval passes
const STREAMING_THROTTLE_MS = 100;

/**
 * Hook that handles messages from VSCode extension and syncs them to Zustand store
 *
 * Uses granular message types for selective state updates instead of full state broadcasts
 */
export function useVSCodeMessageHandler() {
  // Throttling state for streaming updates
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingStreamingUpdateRef = useRef<{
    messageIndex: number;
    message: any;
  } | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<WebviewMessage>) => {
      try {
        const message = event.data;
        const store = useExtensionStore.getState();

        // Handle streaming update (incremental - just one message changed)
        if (isChatMessageStreamingUpdate(message)) {
          // Throttle streaming updates to prevent render death spiral
          // Store the latest update and batch them
          pendingStreamingUpdateRef.current = {
            messageIndex: message.messageIndex,
            message: message.message,
          };

          // If there's already a timer, let it handle the batched update
          if (throttleTimerRef.current) {
            return;
          }

          // Set a timer to apply the batched update
          throttleTimerRef.current = setTimeout(() => {
            const pending = pendingStreamingUpdateRef.current;
            if (pending) {
              // Re-read the latest store state to avoid stale data
              const latestStore = useExtensionStore.getState();
              const currentMessages = latestStore.chatMessages;

              // Verify the index is still valid
              if (pending.messageIndex < currentMessages.length) {
                const updatedMessages = [...currentMessages];
                // Merge fields instead of replacing the entire message
                // This preserves any concurrent updates to other fields
                updatedMessages[pending.messageIndex] = {
                  ...currentMessages[pending.messageIndex],
                  ...pending.message,
                  value: {
                    ...currentMessages[pending.messageIndex]?.value,
                    ...pending.message.value,
                  },
                };
                latestStore.setChatMessages(updatedMessages);
              }
            }

            // Clear the throttle state
            throttleTimerRef.current = null;
            pendingStreamingUpdateRef.current = null;
          }, STREAMING_THROTTLE_MS);

          return;
        }

        // Handle full chat messages update (structure changed)
        if (isChatMessagesUpdate(message)) {
          // Limit chat messages to prevent memory issues
          const limitedMessages =
            message.chatMessages.length > MAX_CHAT_MESSAGES
              ? message.chatMessages.slice(-MAX_CHAT_MESSAGES)
              : message.chatMessages;

          if (limitedMessages.length < message.chatMessages.length) {
            const droppedCount = message.chatMessages.length - MAX_CHAT_MESSAGES;
            console.warn(
              `Chat messages exceeded limit (${message.chatMessages.length} > ${MAX_CHAT_MESSAGES}). ` +
                `Dropping ${droppedCount} oldest messages, keeping the most recent ${MAX_CHAT_MESSAGES}.`,
            );
          }

          store.setChatMessages(limitedMessages);
          return;
        }

        // Handle analysis state updates
        if (isAnalysisStateUpdate(message)) {
          store.batchUpdate({
            ruleSets: message.ruleSets,
            enhancedIncidents: message.enhancedIncidents,
            isAnalyzing: message.isAnalyzing,
            isAnalysisScheduled: message.isAnalysisScheduled,
            analysisProgress: message.analysisProgress ?? 0,
            analysisProgressMessage: message.analysisProgressMessage ?? "",
          });
          return;
        }

        // Handle solution workflow updates
        if (isSolutionWorkflowUpdate(message)) {
          const pendingCount = message.pendingBatchReview?.length || 0;
          const previousPendingCount = store.pendingBatchReview?.length || 0;
          const wasProcessing = store.isProcessingQueuedMessages;
          const isNowProcessing = message.isProcessingQueuedMessages;
          console.log(
            `[useVSCodeMessageHandler] SOLUTION_WORKFLOW_UPDATE received, pendingBatchReview: ${pendingCount} files, isProcessingQueuedMessages: ${wasProcessing} -> ${isNowProcessing}`,
          );
          store.batchUpdate({
            isFetchingSolution: message.isFetchingSolution,
            solutionState: message.solutionState,
            solutionScope: message.solutionScope,
            isWaitingForUserInteraction: message.isWaitingForUserInteraction,
            isProcessingQueuedMessages: message.isProcessingQueuedMessages,
            pendingBatchReview: message.pendingBatchReview || [],
          });

          const shouldResetBatchOperation =
            store.isBatchOperationInProgress &&
            ((previousPendingCount > 0 && pendingCount === 0) ||
              (wasProcessing && !isNowProcessing));

          if (shouldResetBatchOperation) {
            store.setBatchOperationInProgress(false);
            console.log(
              `[useVSCodeMessageHandler] Batch operation completed, resetting isBatchOperationInProgress (pendingCount: ${pendingCount}, processingChanged: ${wasProcessing} -> ${isNowProcessing})`,
            );
          }

          console.log(
            `[useVSCodeMessageHandler] Store updated with pendingBatchReview: ${pendingCount} files`,
          );
          return;
        }

        if (isServerStateUpdate(message)) {
          store.batchUpdate({
            serverState: message.serverState,
            isStartingServer: message.isStartingServer,
            isInitializingServer: message.isInitializingServer,
            solutionServerConnected: message.solutionServerConnected,
            profileSyncConnected: message.profileSyncConnected,
            llmProxyAvailable: message.llmProxyAvailable,
          });
          return;
        }

        // Handle profile updates
        if (isProfilesUpdate(message)) {
          store.batchUpdate({
            profiles: message.profiles,
            activeProfileId: message.activeProfileId,
            isInTreeMode: message.isInTreeMode,
          });
          return;
        }

        // Handle config errors updates
        if (isConfigErrorsUpdate(message)) {
          store.setConfigErrors(message.configErrors);
          return;
        }

        // Handle decorators updates
        if (isDecoratorsUpdate(message)) {
          store.setActiveDecorators(message.activeDecorators);
          return;
        }

        // Handle settings updates
        if (isSettingsUpdate(message)) {
          store.batchUpdate({
            solutionServerEnabled: message.solutionServerEnabled,
            isAgentMode: message.isAgentMode,
            isContinueInstalled: message.isContinueInstalled,
            hubConfig: message.hubConfig,
            hubForced: message.hubForced,
            profileSyncEnabled: message.profileSyncEnabled,
            isSyncingProfiles: message.isSyncingProfiles,
            llmProxyAvailable: message.llmProxyAvailable,
          });
          return;
        }

        // Handle focus violation (from tree view "Open Details" action)
        if (isFocusViolation(message)) {
          store.setFocusedViolationFilter(message.violationMessage);
          return;
        }

        // Handle full state updates (used on initial load)
        if (isFullStateUpdate(message)) {
          // Batch update all state at once for efficiency
          store.batchUpdate({
            ruleSets: Array.isArray(message.ruleSets) ? message.ruleSets : [],
            enhancedIncidents: Array.isArray(message.enhancedIncidents)
              ? message.enhancedIncidents
              : [],
            isAnalyzing: message.isAnalyzing ?? false,
            analysisProgress: message.analysisProgress ?? 0,
            analysisProgressMessage: message.analysisProgressMessage ?? "",
            isFetchingSolution: message.isFetchingSolution ?? false,
            isStartingServer: message.isStartingServer ?? false,
            isInitializingServer: message.isInitializingServer ?? false,
            isAnalysisScheduled: message.isAnalysisScheduled ?? false,
            isContinueInstalled: message.isContinueInstalled ?? false,
            serverState: message.serverState ?? "initial",
            solutionState: message.solutionState ?? "none",
            solutionScope: message.solutionScope,
            solutionServerEnabled: message.solutionServerEnabled ?? false,
            solutionServerConnected: message.solutionServerConnected ?? false,
            isAgentMode: message.isAgentMode ?? false,
            workspaceRoot: message.workspaceRoot ?? "/",
            activeProfileId: message.activeProfileId ?? null,
            isWaitingForUserInteraction: message.isWaitingForUserInteraction ?? false,
            isProcessingQueuedMessages: message.isProcessingQueuedMessages ?? false,
            activeDecorators: message.activeDecorators ?? {},
            profiles: Array.isArray(message.profiles) ? message.profiles : [],
            configErrors: Array.isArray(message.configErrors) ? message.configErrors : [],
            pendingBatchReview: Array.isArray(message.pendingBatchReview)
              ? message.pendingBatchReview
              : [],
            chatMessages:
              Array.isArray(message.chatMessages) && message.chatMessages.length > MAX_CHAT_MESSAGES
                ? message.chatMessages.slice(-MAX_CHAT_MESSAGES)
                : Array.isArray(message.chatMessages)
                  ? message.chatMessages
                  : [],
            hubConfig: message.hubConfig,
            hubForced: message.hubForced,
            profileSyncEnabled: message.profileSyncEnabled ?? false,
            profileSyncConnected: message.profileSyncConnected ?? false,
            isSyncingProfiles: message.isSyncingProfiles ?? false,
            llmProxyAvailable: message.llmProxyAvailable ?? false,
          });
        }
      } catch (error) {
        // Log the error and the problematic message for debugging
        console.error("[useVSCodeMessageHandler] Error handling message:", error);
        console.error("[useVSCodeMessageHandler] Offending message:", event.data);

        // Clean up any pending throttle operations to avoid stuck state
        if (throttleTimerRef.current) {
          clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }
        pendingStreamingUpdateRef.current = null;

        // Optionally update error state in the store (could be used for user notification)
        try {
          const store = useExtensionStore.getState();
          if (store.setConfigErrors) {
            // Add error to config errors as a way to surface it to the UI
            store.setConfigErrors([
              ...store.configErrors,
              {
                type: "provider-connection-failed" as ConfigErrorType,
                message: `Message handler error: ${error instanceof Error ? error.message : String(error)}`,
              },
            ]);
          }
        } catch (storeError) {
          // Even if store update fails, don't let it break the handler
          console.error("[useVSCodeMessageHandler] Failed to update error state:", storeError);
        }

        // Do not re-throw - this ensures the message handler continues working
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
      // Clean up throttle timer on unmount
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);
}
