/**
 * Settings Domain Actions
 *
 * All extension settings operations (non-Hub settings)
 */

import type { StateCreator } from "zustand";
import type { ExtensionStore } from "../extensionStore";

/**
 * Settings domain action types
 */
export interface SettingsDomainActions {
  /**
   * Settings domain
   * All extension settings operations
   */
  settings: {
    /**
     * Set workspace root path
     */
    setWorkspace: (root: string) => void;

    /**
     * Agent mode (AI-powered automatic fixes)
     */
    agentMode: {
      /**
       * Enable agent mode
       */
      enable: () => void;

      /**
       * Disable agent mode
       */
      disable: () => void;

      /**
       * Toggle agent mode
       */
      toggle: () => void;
    };

    /**
     * Continue extension integration
     */
    continueExtension: {
      /**
       * Detect Continue extension installation
       */
      detectInstallation: (installed: boolean) => void;
    };
  };
}

/**
 * Create Settings domain actions
 * This slice focuses on extension settings business logic
 */
export const createSettingsActions: StateCreator<
  ExtensionStore,
  [["zustand/subscribeWithSelector", never], ["zustand/immer", never]],
  [],
  SettingsDomainActions
> = (set) => ({
  settings: {
    setWorkspace: (root) =>
      set((state) => {
        state.workspaceRoot = root;
      }),

    agentMode: {
      enable: () =>
        set((state) => {
          state.isAgentMode = true;
        }),

      disable: () =>
        set((state) => {
          state.isAgentMode = false;
        }),

      toggle: () =>
        set((state) => {
          state.isAgentMode = !state.isAgentMode;
        }),
    },

    continueExtension: {
      detectInstallation: (installed) =>
        set((state) => {
          state.isContinueInstalled = installed;
        }),
    },
  },
});
