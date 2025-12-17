/**
 * Message Type Constants
 *
 * Single source of truth for all message type strings.
 * Use these constants instead of string literals to prevent typos and enable autocomplete.
 *
 * Benefits:
 * - ✅ No string literal duplication
 * - ✅ TypeScript autocomplete
 * - ✅ Can't typo message types
 * - ✅ Single place to add new message types
 */

export const MessageTypes = {
  // Analysis
  ANALYSIS_STATE_UPDATE: "ANALYSIS_STATE_UPDATE",
  ANALYSIS_FLAGS_UPDATE: "ANALYSIS_FLAGS_UPDATE",

  // Chat
  CHAT_METADATA_UPDATE: "CHAT_METADATA_UPDATE",
  CHAT_MESSAGES_UPDATE: "CHAT_MESSAGES_UPDATE",
  CHAT_MESSAGE_STREAMING_UPDATE: "CHAT_MESSAGE_STREAMING_UPDATE",

  // Profiles
  PROFILES_UPDATE: "PROFILES_UPDATE",

  // Server
  SERVER_STATE_UPDATE: "SERVER_STATE_UPDATE",

  // Solution
  SOLUTION_LOADING_UPDATE: "SOLUTION_LOADING_UPDATE",
  SOLUTION_WORKFLOW_UPDATE: "SOLUTION_WORKFLOW_UPDATE",

  // Config & Settings
  CONFIG_ERRORS_UPDATE: "CONFIG_ERRORS_UPDATE",
  DECORATORS_UPDATE: "DECORATORS_UPDATE",
  SETTINGS_UPDATE: "SETTINGS_UPDATE",
} as const;

/**
 * Type for all valid message type strings
 */
export type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes];

/**
 * Messages that use batchUpdate handler in webview
 * When adding a new message that should use batchUpdate, add it here
 */
export const BATCH_UPDATE_MESSAGES = [
  MessageTypes.ANALYSIS_STATE_UPDATE,
  MessageTypes.ANALYSIS_FLAGS_UPDATE,
  MessageTypes.CHAT_METADATA_UPDATE,
  MessageTypes.PROFILES_UPDATE,
  MessageTypes.SERVER_STATE_UPDATE,
  MessageTypes.SOLUTION_LOADING_UPDATE,
  MessageTypes.CONFIG_ERRORS_UPDATE,
  MessageTypes.DECORATORS_UPDATE,
  MessageTypes.SETTINGS_UPDATE,
] as const;
