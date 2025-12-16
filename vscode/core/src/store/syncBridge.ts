/**
 * Sync Bridge Utility
 *
 * Creates declarative bridges between vanilla Zustand store slices and webview broadcasts.
 * Each bridge watches a specific slice of state and automatically broadcasts changes to webviews.
 *
 * Benefits:
 * - Declarative: Define sync rules once, forget about manual broadcasts
 * - Selective: Only sync what you need (e.g., boolean flags vs large arrays)
 * - Efficient: Custom equality functions prevent unnecessary broadcasts
 * - Type-safe: Full TypeScript support
 * - Disposable: Clean up subscriptions when needed
 */

import type { StoreApi } from "zustand/vanilla";
import type { ExtensionStore, ExtensionStoreState } from "./extensionStore";
import type { KonveyorGUIWebviewViewProvider } from "../KonveyorGUIWebviewViewProvider";

/**
 * Store with subscribeWithSelector middleware
 */
export type StoreWithSelector<T> = StoreApi<T> & {
  subscribe: {
    (listener: (state: T, prevState: T) => void): () => void;
    <U>(
      selector: (state: T) => U,
      listener: (selectedState: U, previousSelectedState: U) => void,
      options?: {
        equalityFn?: (a: U, b: U) => boolean;
        fireImmediately?: boolean;
      },
    ): () => void;
  };
};

/**
 * Equality function type for comparing state slices
 */
export type EqualityFn<T> = (prev: T, next: T) => boolean;

/**
 * Default shallow equality check
 */
const shallowEqual = <T>(prev: T, next: T): boolean => {
  if (prev === next) {
    return true;
  }
  if (typeof prev !== "object" || typeof next !== "object") {
    return false;
  }
  if (prev === null || next === null) {
    return false;
  }

  const keysA = Object.keys(prev);
  const keysB = Object.keys(next);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (const key of keysA) {
    if ((prev as any)[key] !== (next as any)[key]) {
      return false;
    }
  }

  return true;
};

/**
 * Options for creating a sync bridge
 */
export interface SyncBridgeOptions<T> {
  /**
   * Selector function to extract the slice of state to watch
   */
  selector: (state: ExtensionStoreState) => T;

  /**
   * Message type to broadcast to webviews
   */
  messageType: string;

  /**
   * Function to transform selected state into message payload
   * If not provided, the selected state is used as-is
   */
  toMessage?: (data: T) => any;

  /**
   * Optional equality function to determine if state has changed
   * If not provided, uses strict equality (===)
   */
  equalityFn?: EqualityFn<T>;

  /**
   * Optional debug name for logging
   */
  debugName?: string;
}

/**
 * A sync bridge manages a subscription and broadcasts
 */
export interface SyncBridge {
  /**
   * Dispose of the subscription
   */
  dispose: () => void;

  /**
   * Get debug information about this bridge
   */
  getDebugInfo: () => {
    messageType: string;
    debugName?: string;
    isActive: boolean;
  };
}

/**
 * Manager for all sync bridges
 */
export class SyncBridgeManager {
  private bridges: SyncBridge[] = [];
  private webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>;
  private store: StoreWithSelector<ExtensionStore>;
  private logger?: {
    debug: (message: string) => void;
    info: (message: string) => void;
  };

  constructor(
    store: StoreWithSelector<ExtensionStore>,
    webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>,
    logger?: { debug: (message: string) => void; info: (message: string) => void },
  ) {
    this.store = store;
    this.webviewProviders = webviewProviders;
    this.logger = logger;
  }

  /**
   * Create a sync bridge for a state slice
   */
  createBridge<T>(options: SyncBridgeOptions<T>): SyncBridge {
    const { selector, messageType, toMessage, equalityFn, debugName } = options;

    let isActive = true;
    let previousValue = selector(this.store.getState());

    // Subscribe to state changes
    // Note: subscribeWithSelector middleware provides a special subscribe method
    // that takes a selector function and returns an unsubscribe function
    const unsubscribe = this.store.subscribe(
      selector,
      (nextValue: T) => {
        if (!isActive) {
          return;
        }

        // Check if value actually changed using custom equality function
        const hasChanged = equalityFn
          ? !equalityFn(previousValue, nextValue)
          : previousValue !== nextValue;

        if (!hasChanged) {
          return;
        }

        previousValue = nextValue;

        // Transform to message payload
        const payload = toMessage ? toMessage(nextValue) : nextValue;

        // Create message with type and timestamp
        const message = {
          type: messageType,
          ...payload,
          timestamp: new Date().toISOString(),
        };

        // Broadcast to all webviews
        this.broadcastToWebviews(message);

        if (this.logger) {
          this.logger.debug(
            `[SyncBridge${debugName ? ` ${debugName}` : ""}] Broadcasted ${messageType}`,
          );
        }
      },
      {
        // Subscribe with selector middleware supports equality function
        equalityFn: equalityFn,
      },
    );

    const bridge: SyncBridge = {
      dispose: () => {
        isActive = false;
        unsubscribe();
        const index = this.bridges.indexOf(bridge);
        if (index !== -1) {
          this.bridges.splice(index, 1);
        }
        if (this.logger) {
          this.logger.debug(
            `[SyncBridge${debugName ? ` ${debugName}` : ""}] Disposed ${messageType}`,
          );
        }
      },

      getDebugInfo: () => ({
        messageType,
        debugName,
        isActive,
      }),
    };

    this.bridges.push(bridge);
    return bridge;
  }

  /**
   * Broadcast message to all webviews
   */
  private broadcastToWebviews(message: any) {
    this.webviewProviders.forEach((provider) => {
      try {
        provider.sendMessageToWebview(message);
      } catch (error) {
        if (this.logger) {
          this.logger.debug(`[SyncBridge] Error broadcasting to webview: ${error}`);
        }
      }
    });
  }

  /**
   * Dispose all bridges
   */
  disposeAll() {
    const count = this.bridges.length;
    this.bridges.forEach((bridge) => bridge.dispose());
    this.bridges = [];
    if (this.logger) {
      this.logger.info(`[SyncBridge] Disposed ${count} bridges`);
    }
  }

  /**
   * Get debug information about all bridges
   */
  getDebugInfo() {
    return {
      totalBridges: this.bridges.length,
      bridges: this.bridges.map((bridge) => bridge.getDebugInfo()),
    };
  }
}

/**
 * Create a sync bridge (convenience function for single bridge creation)
 */
export function createSyncBridge<T>(
  store: StoreWithSelector<ExtensionStore>,
  webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>,
  options: SyncBridgeOptions<T>,
): SyncBridge {
  const manager = new SyncBridgeManager(store, webviewProviders);
  return manager.createBridge(options);
}

/**
 * Common equality functions
 */
export const equalityFns = {
  /**
   * Shallow equality for objects
   */
  shallow: shallowEqual,

  /**
   * Deep equality using JSON.stringify (expensive, use sparingly)
   */
  deep: <T>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b),

  /**
   * Array equality by length and shallow element comparison
   */
  array: <T>(a: T[], b: T[]) => {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => item === b[i]);
  },
};
