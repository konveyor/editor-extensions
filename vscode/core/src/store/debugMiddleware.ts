/**
 * Debug Middleware for Zustand Store
 *
 * Phase 5, Issue 15: Add logging/debug middleware
 *
 * This middleware logs state transitions and can dump current state for debugging.
 */

import type { StateCreator } from "zustand/vanilla";
import type winston from "winston";

export interface DebugMiddlewareOptions {
  logger?: winston.Logger;
  enabled?: boolean;
  logStateChanges?: boolean;
  logActions?: boolean;
}

/**
 * Debug middleware that logs state changes and actions
 */
export const debugMiddleware =
  <T>(options: DebugMiddlewareOptions) =>
  (config: StateCreator<T, [], []>): StateCreator<T, [], []> =>
  (set, get, api) => {
    const { logger, enabled = true, logStateChanges = true, logActions = true } = options;

    if (!enabled) {
      return config(set, get, api);
    }

    const debugSet: typeof set = (partial, replace?) => {
      const prevState = get();

      // Call original set
      if (replace === true) {
        set(partial as T, true);
      } else {
        set(partial, false);
      }

      const nextState = get();

      if (logStateChanges && logger) {
        // Find what changed
        const changes: string[] = [];
        for (const key in nextState) {
          if ((prevState as any)[key] !== (nextState as any)[key]) {
            changes.push(key);
          }
        }

        if (changes.length > 0) {
          logger.debug(`[Zustand Store] State changed: ${changes.join(", ")}`);
        }
      }

      if (logActions && logger) {
        // Try to identify the action from the call stack
        // This is a best-effort approach
        const timestamp = new Date().toISOString();
        logger.debug(`[Zustand Store] Action at ${timestamp}`);
      }
    };

    return config(debugSet, get, api);
  };

/**
 * Helper to dump current store state (for debugging)
 */
export function dumpStoreState<T>(store: { getState: () => T }, logger?: winston.Logger): T {
  const state = store.getState();

  if (logger) {
    logger.info("[Zustand Store] Current state:", JSON.stringify(state, null, 2));
  } else {
    console.log("[Zustand Store] Current state:", state);
  }

  return state;
}

/**
 * Helper to create a command that dumps store state
 */
export function createDumpStateCommand<T>(
  store: { getState: () => T },
  logger?: winston.Logger,
): () => void {
  return () => {
    dumpStoreState(store, logger);
  };
}
