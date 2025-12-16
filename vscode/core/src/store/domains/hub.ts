/**
 * Hub Domain Actions
 *
 * All Hub integration operations: configuration, connections, profile sync, solution server
 */

import type { HubConfig } from "@editor-extensions/shared";
import type { StateCreator } from "zustand";
import type { ExtensionStore } from "../extensionStore";

/**
 * Hub domain action types
 */
export interface HubDomainActions {
  /**
   * Hub integration domain
   * All Hub-related operations: configuration, connections, profile sync
   */
  hub: {
    /**
     * User configured Hub from settings UI
     * Applies config and updates all derived state atomically
     */
    applyConfigurationFromUI: (
      config: HubConfig,
      connectionManager: {
        isSolutionServerConnected: () => boolean;
        isProfileSyncConnected: () => boolean;
      },
    ) => void;

    /**
     * Connection status operations
     */
    connection: {
      /**
       * Update all connection statuses from the manager
       */
      syncStatus: (connectionManager: {
        isSolutionServerConnected: () => boolean;
        isProfileSyncConnected: () => boolean;
        isLlmProxyAvailable: () => boolean;
      }) => void;
    };

    /**
     * Solution server operations
     */
    solutionServer: {
      /**
       * Mark solution server as connected
       */
      markConnected: () => void;

      /**
       * Mark solution server as disconnected
       */
      markDisconnected: () => void;
    };

    /**
     * Profile sync operations
     */
    profileSync: {
      /**
       * Begin profile sync operation
       */
      begin: () => void;

      /**
       * Complete profile sync successfully
       */
      complete: () => void;

      /**
       * Profile sync failed
       */
      fail: () => void;

      /**
       * Mark profile sync as connected
       */
      markConnected: () => void;

      /**
       * Mark profile sync as disconnected
       */
      markDisconnected: () => void;
    };
  };
}

/**
 * Create Hub domain actions
 * This slice focuses on Hub integration business logic
 */
export const createHubActions: StateCreator<
  ExtensionStore,
  [["zustand/subscribeWithSelector", never], ["zustand/immer", never]],
  [],
  HubDomainActions
> = (set) => ({
  hub: {
    /**
     * User configured Hub from settings UI
     * Applies config and updates all derived state atomically
     */
    applyConfigurationFromUI: (config, connectionManager) =>
      set((state) => {
        // Update Hub config
        state.hubConfig = config;

        // Business rule: Feature flags determine service enablement
        state.solutionServerEnabled = config.enabled && config.features.solutionServer.enabled;
        state.profileSyncEnabled = config.enabled && config.features.profileSync.enabled;

        // Business rule: Sync connection status from manager
        state.solutionServerConnected = connectionManager.isSolutionServerConnected();
        state.profileSyncConnected = connectionManager.isProfileSyncConnected();

        // Business rule: Clear syncing flag if profile sync not connected
        if (!connectionManager.isProfileSyncConnected()) {
          state.isSyncingProfiles = false;
        }
      }),

    /**
     * Connection status operations
     */
    connection: {
      /**
       * Update all connection statuses from the manager
       */
      syncStatus: (connectionManager) =>
        set((state) => {
          state.solutionServerConnected = connectionManager.isSolutionServerConnected();
          state.profileSyncConnected = connectionManager.isProfileSyncConnected();
          state.llmProxyAvailable = connectionManager.isLlmProxyAvailable();
        }),
    },

    /**
     * Solution server operations
     */
    solutionServer: {
      markConnected: () =>
        set((state) => {
          state.solutionServerConnected = true;
        }),

      markDisconnected: () =>
        set((state) => {
          state.solutionServerConnected = false;
        }),
    },

    /**
     * Profile sync operations
     */
    profileSync: {
      begin: () =>
        set((state) => {
          state.isSyncingProfiles = true;
        }),

      complete: () =>
        set((state) => {
          state.isSyncingProfiles = false;
        }),

      fail: () =>
        set((state) => {
          state.isSyncingProfiles = false;
        }),

      markConnected: () =>
        set((state) => {
          state.profileSyncConnected = true;
        }),

      markDisconnected: () =>
        set((state) => {
          state.profileSyncConnected = false;
        }),
    },
  },
});
