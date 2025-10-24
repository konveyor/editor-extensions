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
} from "@editor-extensions/shared";
import { useExtensionStore } from "../store/store";

// Maximum number of chat messages to keep in memory
const MAX_CHAT_MESSAGES = 2000000000000;

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
            const currentMessages = store.chatMessages;
            if (pending.messageIndex < currentMessages.length) {
              const updatedMessages = [...currentMessages];
              updatedMessages[pending.messageIndex] = {
                ...pending.message,
                value: { ...pending.message.value },
              };
              store.setChatMessages(updatedMessages);
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
          console.warn(
            `Chat messages exceeded limit (${message.chatMessages.length} > ${MAX_CHAT_MESSAGES}). ` +
              `Keeping only the most recent ${MAX_CHAT_MESSAGES} messages.`,
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
        });
        return;
      }

      // Handle solution workflow updates
      if (isSolutionWorkflowUpdate(message)) {
        const pendingCount = message.pendingBatchReview?.length || 0;
        console.log(
          `[useVSCodeMessageHandler] SOLUTION_WORKFLOW_UPDATE received, pendingBatchReview: ${pendingCount} files`,
        );
        store.batchUpdate({
          isFetchingSolution: message.isFetchingSolution,
          solutionState: message.solutionState,
          solutionScope: message.solutionScope,
          isWaitingForUserInteraction: message.isWaitingForUserInteraction,
          isProcessingQueuedMessages: message.isProcessingQueuedMessages,
          pendingBatchReview: message.pendingBatchReview || [],
        });
        console.log(
          `[useVSCodeMessageHandler] Store updated with pendingBatchReview: ${pendingCount} files`,
        );
        return;
      }

      // Handle server state updates
      if (isServerStateUpdate(message)) {
        store.batchUpdate({
          serverState: message.serverState,
          isStartingServer: message.isStartingServer,
          isInitializingServer: message.isInitializingServer,
          solutionServerConnected: message.solutionServerConnected,
        });
        return;
      }

      // Handle profile updates
      if (isProfilesUpdate(message)) {
        store.batchUpdate({
          profiles: message.profiles,
          activeProfileId: message.activeProfileId,
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
        });
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
        });
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
