/**
 * Message Type Constants
 *
 * Single source of truth for all message types used in extension <-> webview communication.
 * Using constants instead of string literals provides:
 * - Autocomplete in IDEs
 * - Compile-time validation (no typos)
 * - Single place to add/modify message types
 */

export const MessageTypes = {
  // Full state (initial load)
  FULL_STATE_UPDATE: "FULL_STATE_UPDATE",

  // Analysis
  ANALYSIS_STATE_UPDATE: "ANALYSIS_STATE_UPDATE",

  // Chat
  CHAT_MESSAGES_UPDATE: "CHAT_MESSAGES_UPDATE",
  CHAT_MESSAGE_STREAMING_UPDATE: "CHAT_MESSAGE_STREAMING_UPDATE",

  // Profiles
  PROFILES_UPDATE: "PROFILES_UPDATE",

  // Server
  SERVER_STATE_UPDATE: "SERVER_STATE_UPDATE",

  // Solution
  SOLUTION_WORKFLOW_UPDATE: "SOLUTION_WORKFLOW_UPDATE",

  // Config & Settings
  CONFIG_ERRORS_UPDATE: "CONFIG_ERRORS_UPDATE",
  DECORATORS_UPDATE: "DECORATORS_UPDATE",
  SETTINGS_UPDATE: "SETTINGS_UPDATE",
} as const;

export type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes];
