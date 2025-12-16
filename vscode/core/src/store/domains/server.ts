/**
 * Server Domain Actions
 *
 * All analyzer server lifecycle operations: start, stop, initialize, state tracking
 */

import type { ServerState } from "@editor-extensions/shared";
import type { StateCreator } from "zustand";
import type { ExtensionStore } from "../extensionStore";

/**
 * Server domain action types
 */
export interface ServerDomainActions {
  /**
   * Server domain
   * All analyzer server lifecycle operations
   */
  server: {
    /**
     * Begin starting the server
     */
    beginStart: () => void;

    /**
     * Begin initializing the server
     */
    beginInitialize: () => void;

    /**
     * Mark server as running
     */
    markRunning: () => void;

    /**
     * Stop the server
     */
    stop: () => void;

    /**
     * Server failed to start
     */
    fail: (error: Error) => void;

    /**
     * Update server state directly (for special cases)
     */
    setState: (state: ServerState) => void;
  };
}

/**
 * Create Server domain actions
 * This slice focuses on analyzer server lifecycle business logic
 */
export const createServerActions: StateCreator<
  ExtensionStore,
  [["zustand/subscribeWithSelector", never], ["zustand/immer", never]],
  [],
  ServerDomainActions
> = (set) => ({
  server: {
    beginStart: () =>
      set((state) => {
        state.isStartingServer = true;
        state.serverState = "starting";
      }),

    beginInitialize: () =>
      set((state) => {
        state.isInitializingServer = true;
        state.serverState = "initializing";
      }),

    markRunning: () =>
      set((state) => {
        state.isStartingServer = false;
        state.isInitializingServer = false;
        state.serverState = "running";
      }),

    stop: () =>
      set((state) => {
        state.isStartingServer = false;
        state.isInitializingServer = false;
        state.serverState = "stopped";
      }),

    fail: (error) =>
      set((state) => {
        state.isStartingServer = false;
        state.isInitializingServer = false;
        state.serverState = "startFailed";
        // Could add error tracking here if needed
      }),

    setState: (serverState) =>
      set((state) => {
        state.serverState = serverState;

        // Business rule: Clear flags based on state
        if (
          serverState === "running" ||
          serverState === "stopped" ||
          serverState === "startFailed"
        ) {
          state.isStartingServer = false;
          state.isInitializingServer = false;
        }
      }),
  },
});
