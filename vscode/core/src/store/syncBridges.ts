import { MessageTypes, GooseMessageTypes } from "@editor-extensions/shared";
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
 * Fields tracked by the consolidated state change bridge.
 * Excludes chatMessages (handled by a dedicated streaming bridge)
 * and goose state (handled by a dedicated goose bridge).
 */
const STATE_CHANGE_KEYS: readonly string[] = [
  // Analysis
  "ruleSets",
  "enhancedIncidents",
  "isAnalyzing",
  "isAnalysisScheduled",
  "analysisProgress",
  "analysisProgressMessage",
  // Solution workflow
  "isFetchingSolution",
  "solutionState",
  "solutionScope",
  "isWaitingForUserInteraction",
  "isProcessingQueuedMessages",
  "pendingBatchReview",
  // Server
  "serverState",
  "isStartingServer",
  "isInitializingServer",
  "solutionServerConnected",
  "profileSyncConnected",
  "llmProxyAvailable",
  // Profiles
  "profiles",
  "activeProfileId",
  "isInTreeMode",
  // Config errors
  "configErrors",
  // Decorators
  "activeDecorators",
  // Settings
  "solutionServerEnabled",
  "isAgentMode",
  "isContinueInstalled",
  "hubConfig",
  "hubForced",
  "profileSyncEnabled",
  "isSyncingProfiles",
];

/** Keys that, when changed, should fire the onDidChange event for the issue view tree. */
const ANALYSIS_KEYS = new Set([
  "ruleSets",
  "enhancedIncidents",
  "isAnalyzing",
  "isAnalysisScheduled",
  "analysisProgress",
  "analysisProgressMessage",
]);

export interface SyncBridgeOptions {
  /**
   * Event emitter for the global onDidChange event.
   * Fired when analysis-related state changes (used by the issue view tree provider).
   */
  onDidChangeEmitter?: vscode.EventEmitter<unknown>;
}

/**
 * Sets up subscription-based sync bridges between the Zustand store and webview providers.
 *
 * Three bridges:
 * 1. Consolidated state bridge — watches all non-chat, non-goose fields and sends a single
 *    STATE_CHANGE message containing only the fields that actually changed.
 * 2. Chat messages bridge — detects streaming vs structural changes and sends deltas.
 * 3. Goose state bridge — watches gooseState/gooseError and sends GOOSE_STATE_CHANGE.
 *    All goose messaging (state, chat, streaming) is self-contained outside of STATE_CHANGE.
 *
 * Returns a disposable that unsubscribes all bridges.
 */
export function setupSyncBridges(
  store: ExtensionStore,
  getProviders: () => Map<string, KonveyorGUIWebviewViewProvider>,
  options: SyncBridgeOptions = {},
): { dispose: () => void } {
  const unsubscribers: (() => void)[] = [];

  // --- Consolidated state bridge ---
  // Selects all non-chat fields into one object. On change, computes a delta
  // of only the fields that differ and sends a single STATE_CHANGE message.
  type StateSlice = Record<string, unknown>;

  const selectStateSlice = (s: any): StateSlice => {
    const slice: StateSlice = {};
    for (const key of STATE_CHANGE_KEYS) {
      slice[key] = s[key];
    }
    return slice;
  };

  unsubscribers.push(
    store.subscribe(
      selectStateSlice,
      (current, previous) => {
        const data: Record<string, unknown> = {};
        let hasChanges = false;
        let hasAnalysisChanges = false;

        for (const key of STATE_CHANGE_KEYS) {
          if (current[key] !== previous[key]) {
            data[key] = current[key];
            hasChanges = true;
            if (ANALYSIS_KEYS.has(key)) {
              hasAnalysisChanges = true;
            }
          }
        }

        if (!hasChanges) {
          return;
        }

        // Normalize: ensure pendingBatchReview is always an array when present
        if ("pendingBatchReview" in data && !data.pendingBatchReview) {
          data.pendingBatchReview = [];
        }

        // Normalize: ensure activeDecorators is always an object when present
        if ("activeDecorators" in data && !data.activeDecorators) {
          data.activeDecorators = {};
        }

        broadcast(getProviders, {
          type: MessageTypes.STATE_CHANGE,
          data,
          timestamp: new Date().toISOString(),
        });

        // Fire global change event for extension-internal listeners (issue view tree)
        if (hasAnalysisChanges && options.onDidChangeEmitter) {
          options.onDidChangeEmitter.fire(store.getState());
        }
      },
      {
        equalityFn: (a, b) => {
          for (const key of STATE_CHANGE_KEYS) {
            if (a[key] !== b[key]) {
              return false;
            }
          }
          return true;
        },
      },
    ),
  );

  // --- Chat messages bridge ---
  // Preserves the existing streaming optimization:
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
            type: MessageTypes.CHAT_STREAMING_UPDATE,
            message: plainMessage,
            messageIndex: currentLength - 1,
            timestamp: new Date().toISOString(),
          });
        } else {
          // Structural change — send full array
          broadcast(getProviders, {
            type: MessageTypes.CHAT_STATE_CHANGE,
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

  // --- Goose state bridge ---
  // Watches gooseState and gooseError, sends a self-contained GOOSE_STATE_CHANGE message.
  // Keeps all goose messaging outside of the core STATE_CHANGE channel.
  unsubscribers.push(
    store.subscribe(
      (s) => ({
        gooseState: s.featureState?.gooseState,
        gooseError: s.featureState?.gooseError,
      }),
      (current, previous) => {
        if (
          current.gooseState === previous.gooseState &&
          current.gooseError === previous.gooseError
        ) {
          return;
        }

        broadcast(getProviders, {
          type: GooseMessageTypes.GOOSE_STATE_CHANGE,
          gooseState: current.gooseState,
          gooseError: current.gooseError,
          timestamp: new Date().toISOString(),
        });
      },
      {
        equalityFn: (a, b) => a.gooseState === b.gooseState && a.gooseError === b.gooseError,
      },
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
