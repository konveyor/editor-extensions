import { useEffect, useRef } from "react";
import { ConfigErrorType, BATCH_UPDATE_MESSAGES } from "@editor-extensions/shared";
import { useExtensionStore } from "../store/store";

/**
 * Maximum number of chat messages to keep in memory.
 * When this limit is reached, older messages are automatically removed.
 */
const MAX_CHAT_MESSAGES = 50000;

/**
 * Throttle streaming updates to prevent UI death spiral.
 * Updates will batch until this interval passes.
 */
const STREAMING_THROTTLE_MS = 100;

/**
 * Message types that can be handled with simple batchUpdate.
 * These messages have payloads that directly map to store state.
 *
 * Imported from shared package to ensure consistency with sync bridges.
 */
const BATCH_UPDATE_MESSAGE_TYPES = BATCH_UPDATE_MESSAGES;

/**
 * Hook that handles messages from VSCode extension and syncs them to Zustand store.
 *
 * Architecture:
 * - Extension Host (vanilla Zustand) = Source of truth with domain actions
 * - Webview (React Zustand) = Dumb replica for UI rendering
 * - Sync Bridges = Automatic one-way sync (Extension → Webview)
 *
 * Most messages just need batchUpdate() since the sync bridges send payloads
 * that directly match the store shape.
 */
export function useVSCodeMessageHandler() {
  // Throttling state for streaming updates
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStreamingUpdateRef = useRef<{
    messageIndex: number;
    message: any;
  } | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        // Extract type and payload, ignoring timestamp from sync bridges
        const { type, ...payload } = event.data;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { timestamp, ...cleanPayload } = payload as {
          timestamp?: string;
          [key: string]: any;
        };
        const store = useExtensionStore.getState();

        // ============================================
        // SIMPLE BATCH UPDATES (most common case)
        // Sync bridges send payloads that match store shape
        // ============================================
        if (BATCH_UPDATE_MESSAGE_TYPES.includes(type)) {
          store.batchUpdate(cleanPayload);
          return;
        }

        // ============================================
        // SPECIAL CASES (need custom handling)
        // ============================================

        switch (type) {
          // Chat message streaming (throttled to prevent render death spiral)
          case "CHAT_MESSAGE_STREAMING_UPDATE": {
            pendingStreamingUpdateRef.current = {
              messageIndex: cleanPayload.messageIndex,
              message: cleanPayload.message,
            };

            // If there's already a timer, let it handle the batched update
            if (throttleTimerRef.current) {
              return;
            }

            // Set a timer to apply the batched update
            throttleTimerRef.current = setTimeout(() => {
              const pending = pendingStreamingUpdateRef.current;
              if (pending) {
                const latestStore = useExtensionStore.getState();
                const currentMessages = latestStore.chatMessages;

                if (pending.messageIndex < currentMessages.length) {
                  const updatedMessages = [...currentMessages];
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

              throttleTimerRef.current = null;
              pendingStreamingUpdateRef.current = null;
            }, STREAMING_THROTTLE_MS);
            return;
          }

          // Chat messages update (with memory limit)
          case "CHAT_MESSAGES_UPDATE": {
            const limitedMessages =
              cleanPayload.chatMessages.length > MAX_CHAT_MESSAGES
                ? cleanPayload.chatMessages.slice(-MAX_CHAT_MESSAGES)
                : cleanPayload.chatMessages;

            if (limitedMessages.length < cleanPayload.chatMessages.length) {
              console.warn(
                `[useVSCodeMessageHandler] Chat messages exceeded limit. Dropping oldest messages.`,
              );
            }

            store.setChatMessages(limitedMessages);
            return;
          }

          // Solution workflow update (has side effect logic for batch operation tracking)
          case "SOLUTION_WORKFLOW_UPDATE": {
            const pendingCount = cleanPayload.pendingBatchReview?.length || 0;
            const previousPendingCount = store.pendingBatchReview?.length || 0;
            const wasProcessing = store.isProcessingQueuedMessages;
            const isNowProcessing = cleanPayload.isProcessingQueuedMessages;

            store.batchUpdate({
              isFetchingSolution: cleanPayload.isFetchingSolution,
              solutionState: cleanPayload.solutionState,
              solutionScope: cleanPayload.solutionScope,
              isWaitingForUserInteraction: cleanPayload.isWaitingForUserInteraction,
              isProcessingQueuedMessages: cleanPayload.isProcessingQueuedMessages,
              pendingBatchReview: cleanPayload.pendingBatchReview || [],
            });

            // Side effect: Reset batch operation flag when work completes
            const shouldResetBatchOperation =
              store.isBatchOperationInProgress &&
              ((previousPendingCount > 0 && pendingCount === 0) ||
                (wasProcessing && !isNowProcessing));

            if (shouldResetBatchOperation) {
              store.setBatchOperationInProgress(false);
            }
            return;
          }

          // Full state update (initial load - needs safe defaults)
          case "FULL_STATE_UPDATE": {
            const safePayload = {
              ruleSets: Array.isArray(cleanPayload.ruleSets) ? cleanPayload.ruleSets : [],
              enhancedIncidents: Array.isArray(cleanPayload.enhancedIncidents)
                ? cleanPayload.enhancedIncidents
                : [],
              profiles: Array.isArray(cleanPayload.profiles) ? cleanPayload.profiles : [],
              configErrors: Array.isArray(cleanPayload.configErrors)
                ? cleanPayload.configErrors
                : [],
              pendingBatchReview: Array.isArray(cleanPayload.pendingBatchReview)
                ? cleanPayload.pendingBatchReview
                : [],
              chatMessages: Array.isArray(cleanPayload.chatMessages)
                ? cleanPayload.chatMessages.slice(-MAX_CHAT_MESSAGES)
                : [],
              activeDecorators: cleanPayload.activeDecorators ?? {},
              // Booleans with safe defaults
              isAnalyzing: cleanPayload.isAnalyzing ?? false,
              isFetchingSolution: cleanPayload.isFetchingSolution ?? false,
              isStartingServer: cleanPayload.isStartingServer ?? false,
              isInitializingServer: cleanPayload.isInitializingServer ?? false,
              isAnalysisScheduled: cleanPayload.isAnalysisScheduled ?? false,
              isContinueInstalled: cleanPayload.isContinueInstalled ?? false,
              solutionServerEnabled: cleanPayload.solutionServerEnabled ?? false,
              solutionServerConnected: cleanPayload.solutionServerConnected ?? false,
              isAgentMode: cleanPayload.isAgentMode ?? false,
              isWaitingForUserInteraction: cleanPayload.isWaitingForUserInteraction ?? false,
              isProcessingQueuedMessages: cleanPayload.isProcessingQueuedMessages ?? false,
              profileSyncEnabled: cleanPayload.profileSyncEnabled ?? false,
              profileSyncConnected: cleanPayload.profileSyncConnected ?? false,
              isSyncingProfiles: cleanPayload.isSyncingProfiles ?? false,
              llmProxyAvailable: cleanPayload.llmProxyAvailable ?? false,
              // Numbers with safe defaults
              analysisProgress: cleanPayload.analysisProgress ?? 0,
              analysisProgressMessage: cleanPayload.analysisProgressMessage ?? "",
              // Strings/enums with safe defaults
              serverState: cleanPayload.serverState ?? "initial",
              solutionState: cleanPayload.solutionState ?? "none",
              workspaceRoot: cleanPayload.workspaceRoot ?? "/",
              activeProfileId: cleanPayload.activeProfileId ?? null,
              // Optional objects
              solutionScope: cleanPayload.solutionScope,
              hubConfig: cleanPayload.hubConfig,
            };

            store.batchUpdate(safePayload);
            return;
          }

          default:
            // Unknown message type - ignore silently
            // This allows for forward compatibility with new message types
            break;
        }
      } catch (error) {
        console.error("[useVSCodeMessageHandler] Error handling message:", error);
        console.error("[useVSCodeMessageHandler] Offending message:", event.data);

        // Clean up any pending throttle operations
        if (throttleTimerRef.current) {
          clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }
        pendingStreamingUpdateRef.current = null;

        // Surface error to UI
        try {
          const store = useExtensionStore.getState();
          store.addConfigError({
            type: "provider-connection-failed" as ConfigErrorType,
            message: `Message handler error: ${error instanceof Error ? error.message : String(error)}`,
          });
        } catch {
          // Ignore - don't let error handling break the handler
        }
      }
    };

    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("message", handleMessage);
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, []);
}
