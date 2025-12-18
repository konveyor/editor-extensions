/**
 * Config Domain Actions
 *
 * All configuration and error management operations
 */

import type { ConfigError, LLMError } from "@editor-extensions/shared";
import type { StateCreator } from "zustand";
import type { ExtensionStore } from "../extensionStore";

/**
 * Config domain action types
 */
export interface ConfigDomainActions {
  /**
   * Config domain
   * All configuration and error management operations
   */
  config: {
    /**
     * Configuration errors
     */
    errors: {
      /**
       * Report a configuration error
       */
      report: (error: ConfigError) => void;

      /**
       * Clear a specific error by type
       */
      clear: (type: ConfigError["type"]) => void;

      /**
       * Clear all configuration errors
       */
      clearAll: () => void;

      /**
       * Replace all errors (used during validation)
       */
      setAll: (errors: ConfigError[]) => void;
    };

    /**
     * LLM errors
     */
    llmErrors: {
      /**
       * Report an LLM error
       */
      report: (error: LLMError) => void;

      /**
       * Clear all LLM errors
       */
      clearAll: () => void;

      /**
       * Replace all LLM errors
       */
      setAll: (errors: LLMError[]) => void;
    };
  };
}

/**
 * Create Config domain actions
 * This slice focuses on configuration and error management business logic
 */
export const createConfigActions: StateCreator<
  ExtensionStore,
  [["zustand/subscribeWithSelector", never], ["zustand/immer", never]],
  [],
  ConfigDomainActions
> = (set) => ({
  config: {
    errors: {
      report: (error) =>
        set((state) => {
          // Business rule: Avoid duplicate errors
          const exists = state.configErrors.some((e) => e.type === error.type);
          if (!exists) {
            state.configErrors.push(error);
          }
        }),

      clear: (type) =>
        set((state) => {
          state.configErrors = state.configErrors.filter((e) => e.type !== type);
        }),

      clearAll: () =>
        set((state) => {
          state.configErrors = [];
        }),

      setAll: (errors) =>
        set((state) => {
          state.configErrors = errors;
        }),
    },

    llmErrors: {
      report: (error) =>
        set((state) => {
          state.llmErrors.push(error);
        }),

      clearAll: () =>
        set((state) => {
          state.llmErrors = [];
        }),

      setAll: (errors) =>
        set((state) => {
          state.llmErrors = errors;
        }),
    },
  },
});
