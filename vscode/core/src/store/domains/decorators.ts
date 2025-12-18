/**
 * Decorators Domain Actions
 *
 * All UI decorator operations: apply, remove, clear decorators for diff viewing
 */

import type { StateCreator } from "zustand";
import type { ExtensionStore } from "../extensionStore";

/**
 * Decorators domain action types
 */
export interface DecoratorsDomainActions {
  /**
   * Decorators domain
   * All UI decorator operations for diff viewing
   */
  decorators: {
    /**
     * Apply decorators for a file (show diff in editor)
     */
    apply: (messageToken: string, filePath: string) => void;

    /**
     * Remove decorators for a specific message token
     */
    remove: (messageToken: string) => void;

    /**
     * Clear all active decorators
     */
    clearAll: () => void;

    /**
     * Check if decorators are active for a message token
     */
    isActive: (messageToken: string) => boolean;
  };
}

/**
 * Create Decorators domain actions
 * This slice focuses on UI decorator business logic
 */
export const createDecoratorsActions: StateCreator<
  ExtensionStore,
  [["zustand/subscribeWithSelector", never], ["zustand/immer", never]],
  [],
  DecoratorsDomainActions
> = (set, get) => ({
  decorators: {
    apply: (messageToken, filePath) =>
      set((state) => {
        state.activeDecorators[messageToken] = filePath;
      }),

    remove: (messageToken) =>
      set((state) => {
        delete state.activeDecorators[messageToken];
      }),

    clearAll: () =>
      set((state) => {
        state.activeDecorators = {};
      }),

    isActive: (messageToken) => {
      const state = get();
      return messageToken in state.activeDecorators;
    },
  },
});
