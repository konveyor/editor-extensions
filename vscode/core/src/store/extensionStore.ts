import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { ExtensionData } from "@editor-extensions/shared";

/**
 * Zustand vanilla store for extension host state.
 *
 * Uses subscribeWithSelector for granular change detection (sync bridges)
 * and immer middleware for ergonomic mutable-style updates.
 *
 * This store replaces the previous pattern of Immer produce() + manual
 * broadcastToWebviews() calls in each mutate* function.
 */

function _createExtensionStore(initialData: ExtensionData) {
  return createStore<ExtensionData>()(
    subscribeWithSelector(
      immer(() => ({
        ...initialData,
      })),
    ),
  );
}

/**
 * The store type includes middleware augmentations:
 * - immer: setState accepts (draft: T) => void (mutative updates)
 * - subscribeWithSelector: subscribe accepts (selector, listener, options?)
 */
export type ExtensionStore = ReturnType<typeof _createExtensionStore>;

export const createExtensionStore = _createExtensionStore;
