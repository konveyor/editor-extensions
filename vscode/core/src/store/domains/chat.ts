/**
 * Chat Domain Actions
 *
 * All chat message operations (stored but not synced - uses on-demand fetching)
 */

import type { ChatMessage } from "@editor-extensions/shared";
import type { StateCreator } from "zustand";
import type { ExtensionStore } from "../extensionStore";

/**
 * Chat domain action types
 */
export interface ChatDomainActions {
  /**
   * Chat domain
   * All chat message operations
   *
   * Note: Chat messages are stored in the extension host but NOT synced via bridge.
   * Webviews use on-demand fetching (GET_CHAT_MESSAGES message) to load messages.
   * This prevents sending 50k+ chat messages on every state change.
   */
  chat: {
    /**
     * Add a new chat message
     */
    addMessage: (message: ChatMessage) => void;

    /**
     * Update a streaming message (partial content updates)
     */
    updateStreamingMessage: (index: number, message: string) => void;

    /**
     * Replace all chat messages (used during initialization)
     */
    setAll: (messages: ChatMessage[]) => void;

    /**
     * Clear all chat messages
     */
    clearAll: () => void;

    /**
     * Get message count (for pagination)
     */
    getCount: () => number;

    /**
     * Get messages slice (for pagination)
     */
    getSlice: (offset: number, limit: number) => ChatMessage[];
  };
}

/**
 * Create Chat domain actions
 * This slice focuses on chat message management business logic
 */
export const createChatActions: StateCreator<
  ExtensionStore,
  [["zustand/subscribeWithSelector", never], ["zustand/immer", never]],
  [],
  ChatDomainActions
> = (set, get) => ({
  chat: {
    addMessage: (message) =>
      set((state) => {
        state.chatMessages.push(message);
      }),

    updateStreamingMessage: (index, message) =>
      set((state) => {
        if (index >= 0 && index < state.chatMessages.length) {
          // Business rule: Update message content for streaming
          const msg = state.chatMessages[index];
          if (typeof msg.value === "object" && "message" in msg.value) {
            msg.value.message = message;
          }
        }
      }),

    setAll: (messages) =>
      set((state) => {
        state.chatMessages = messages;
      }),

    clearAll: () =>
      set((state) => {
        state.chatMessages = [];
      }),

    getCount: () => {
      const state = get();
      return state.chatMessages.length;
    },

    getSlice: (offset, limit) => {
      const state = get();
      return state.chatMessages.slice(offset, offset + limit);
    },
  },
});
