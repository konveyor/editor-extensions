import { MessageTypes } from "@editor-extensions/shared";
import { KonveyorGUIWebviewViewProvider } from "../KonveyorGUIWebviewViewProvider";
import { type ExtensionStore } from "./extensionStore";
import * as vscode from "vscode";

/**
 * Broadcasts a message to all registered webview providers.
 */
function broadcast(
  getProviders: () => Map<string, KonveyorGUIWebviewViewProvider>,
  message: Record<string, unknown>,
): void {
  const providers = getProviders();
  providers.forEach((provider) => {
    provider.sendMessageToWebview(message);
  });
}

/**
 * Shallow equality check for plain objects.
 * Returns true if all enumerable own properties are strictly equal.
 */
function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  if (a === b) {
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

export interface SyncBridgeOptions {
  /**
   * Event emitter for the global onDidChange event.
   * Fired only by the analysis state bridge (used by the issue view tree provider).
   */
  onDidChangeEmitter?: vscode.EventEmitter<unknown>;
}

/**
 * Sets up subscription-based sync bridges between the Zustand store and webview providers.
 *
 * Each bridge subscribes to a slice of the store and broadcasts the corresponding
 * message type to all webview providers when that slice changes.
 *
 * Design:
 * - Cheap bridges (UI flags): individual subscriptions with shallow equality → tiny payloads
 * - Expensive bridges (data collections): reference equality → only sync on real change
 * - Streaming bridge (chat messages): detects streaming vs structural changes, sends deltas
 *
 * Returns a disposable that unsubscribes all bridges.
 */
export function setupSyncBridges(
  store: ExtensionStore,
  getProviders: () => Map<string, KonveyorGUIWebviewViewProvider>,
  options: SyncBridgeOptions = {},
): { dispose: () => void } {
  const unsubscribers: (() => void)[] = [];

  // --- Analysis state bridge ---
  // Watches both UI flags and data collections for analysis.
  // Also fires the global onDidChange event (used by issue view tree provider).
  unsubscribers.push(
    store.subscribe(
      (s) => ({
        ruleSets: s.ruleSets,
        enhancedIncidents: s.enhancedIncidents,
        isAnalyzing: s.isAnalyzing,
        isAnalysisScheduled: s.isAnalysisScheduled,
        analysisProgress: s.analysisProgress,
        analysisProgressMessage: s.analysisProgressMessage,
      }),
      (slice) => {
        broadcast(getProviders, {
          type: MessageTypes.ANALYSIS_STATE_UPDATE,
          ...slice,
          timestamp: new Date().toISOString(),
        });

        // Fire global change event for extension-internal listeners (issue view)
        if (options.onDidChangeEmitter) {
          options.onDidChangeEmitter.fire(store.getState());
        }
      },
      { equalityFn: shallowEqual },
    ),
  );

  // --- Solution workflow bridge ---
  unsubscribers.push(
    store.subscribe(
      (s) => ({
        isFetchingSolution: s.isFetchingSolution,
        solutionState: s.solutionState,
        solutionScope: s.solutionScope,
        isWaitingForUserInteraction: s.isWaitingForUserInteraction,
        isProcessingQueuedMessages: s.isProcessingQueuedMessages,
        pendingBatchReview: s.pendingBatchReview,
      }),
      (slice) => {
        broadcast(getProviders, {
          type: MessageTypes.SOLUTION_WORKFLOW_UPDATE,
          ...slice,
          pendingBatchReview: slice.pendingBatchReview || [],
          timestamp: new Date().toISOString(),
        });
      },
      { equalityFn: shallowEqual },
    ),
  );

  // --- Server state bridge ---
  unsubscribers.push(
    store.subscribe(
      (s) => ({
        serverState: s.serverState,
        isStartingServer: s.isStartingServer,
        isInitializingServer: s.isInitializingServer,
        solutionServerConnected: s.solutionServerConnected,
        profileSyncConnected: s.profileSyncConnected,
        llmProxyAvailable: s.llmProxyAvailable,
      }),
      (slice) => {
        broadcast(getProviders, {
          type: MessageTypes.SERVER_STATE_UPDATE,
          ...slice,
          timestamp: new Date().toISOString(),
        });
      },
      { equalityFn: shallowEqual },
    ),
  );

  // --- Profiles bridge ---
  unsubscribers.push(
    store.subscribe(
      (s) => ({
        profiles: s.profiles,
        activeProfileId: s.activeProfileId,
        isInTreeMode: s.isInTreeMode,
      }),
      (slice) => {
        broadcast(getProviders, {
          type: MessageTypes.PROFILES_UPDATE,
          ...slice,
          timestamp: new Date().toISOString(),
        });
      },
      { equalityFn: shallowEqual },
    ),
  );

  // --- Config errors bridge ---
  unsubscribers.push(
    store.subscribe(
      (s) => s.configErrors,
      (configErrors) => {
        broadcast(getProviders, {
          type: MessageTypes.CONFIG_ERRORS_UPDATE,
          configErrors,
          timestamp: new Date().toISOString(),
        });
      },
      { equalityFn: (a, b) => a === b },
    ),
  );

  // --- Decorators bridge ---
  unsubscribers.push(
    store.subscribe(
      (s) => s.activeDecorators,
      (activeDecorators) => {
        broadcast(getProviders, {
          type: MessageTypes.DECORATORS_UPDATE,
          activeDecorators: activeDecorators || {},
          timestamp: new Date().toISOString(),
        });
      },
      { equalityFn: (a, b) => a === b },
    ),
  );

  // --- Settings bridge ---
  unsubscribers.push(
    store.subscribe(
      (s) => ({
        solutionServerEnabled: s.solutionServerEnabled,
        isAgentMode: s.isAgentMode,
        isContinueInstalled: s.isContinueInstalled,
        hubConfig: s.hubConfig,
        hubForced: s.hubForced,
        profileSyncEnabled: s.profileSyncEnabled,
        isSyncingProfiles: s.isSyncingProfiles,
        llmProxyAvailable: s.llmProxyAvailable,
      }),
      (slice) => {
        broadcast(getProviders, {
          type: MessageTypes.SETTINGS_UPDATE,
          ...slice,
          timestamp: new Date().toISOString(),
        });
      },
      { equalityFn: shallowEqual },
    ),
  );

  // --- Chat messages bridge ---
  // This bridge preserves the existing streaming optimization:
  // - If message count is unchanged and > 0, it's a streaming update → send only the last message
  // - Otherwise it's a structural change → send the full array
  let previousChatMessagesLength = store.getState().chatMessages.length;

  unsubscribers.push(
    store.subscribe(
      (s) => s.chatMessages,
      (chatMessages) => {
        const currentLength = chatMessages.length;
        const isStreamingUpdate = currentLength === previousChatMessagesLength && currentLength > 0;

        if (isStreamingUpdate) {
          // Streaming chunk — send only the last message for efficiency.
          // Create a plain object copy to avoid Immer proxy issues.
          const lastMessage = chatMessages[currentLength - 1];
          const plainMessage = JSON.parse(JSON.stringify(lastMessage));

          broadcast(getProviders, {
            type: MessageTypes.CHAT_MESSAGE_STREAMING_UPDATE,
            message: plainMessage,
            messageIndex: currentLength - 1,
            timestamp: new Date().toISOString(),
          });
        } else {
          // Structural change — send full array
          broadcast(getProviders, {
            type: MessageTypes.CHAT_MESSAGES_UPDATE,
            chatMessages,
            previousLength: previousChatMessagesLength,
            timestamp: new Date().toISOString(),
          });
        }

        previousChatMessagesLength = currentLength;
      },
      { equalityFn: (a, b) => a === b },
    ),
  );

  return {
    dispose() {
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers.length = 0;
    },
  };
}
