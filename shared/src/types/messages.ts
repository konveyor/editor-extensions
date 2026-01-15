import {
  ExtensionData,
  RuleSet,
  EnhancedIncident,
  ChatMessage,
  AnalysisProfile,
  ConfigError,
  ServerState,
  SolutionState,
  Scope,
  PendingBatchReviewFile,
  HubConfig,
} from "./types";

export const MessageTypes = {
  FULL_STATE_UPDATE: "FULL_STATE_UPDATE",

  ANALYSIS_STATE_UPDATE: "ANALYSIS_STATE_UPDATE",

  CHAT_MESSAGES_UPDATE: "CHAT_MESSAGES_UPDATE",
  CHAT_MESSAGE_STREAMING_UPDATE: "CHAT_MESSAGE_STREAMING_UPDATE",
  CHAT_STREAMING_CHUNK: "CHAT_STREAMING_CHUNK",

  PROFILES_UPDATE: "PROFILES_UPDATE",

  SERVER_STATE_UPDATE: "SERVER_STATE_UPDATE",

  SOLUTION_WORKFLOW_UPDATE: "SOLUTION_WORKFLOW_UPDATE",

  CONFIG_ERRORS_UPDATE: "CONFIG_ERRORS_UPDATE",
  DECORATORS_UPDATE: "DECORATORS_UPDATE",
  SETTINGS_UPDATE: "SETTINGS_UPDATE",
} as const;

export type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes];

/**
 * Granular message types for VSCode extension -> Webview communication
 *
 * These messages allow for selective state updates instead of broadcasting
 * the entire state on every change, improving performance.
 */

// Full state update (used on initial load and complete resets)
export type FullStateUpdateMessage = ExtensionData;

// Analysis-related updates
export interface AnalysisStateUpdateMessage {
  type: "ANALYSIS_STATE_UPDATE";
  ruleSets: RuleSet[];
  enhancedIncidents: EnhancedIncident[];
  isAnalyzing: boolean;
  isAnalysisScheduled: boolean;
  analysisProgress?: number;
  analysisProgressMessage?: string;
  timestamp: string;
}

// Chat/messaging updates
export interface ChatMessagesUpdateMessage {
  type: "CHAT_MESSAGES_UPDATE";
  chatMessages: ChatMessage[];
  previousLength: number;
  timestamp: string;
}

export interface ChatStreamingChunkMessage {
  type: "CHAT_STREAMING_CHUNK";
  messageId: string;
  chunk: string;
  timestamp: string;
}

// Chat streaming update (incremental - just one message)
export interface ChatMessageStreamingUpdateMessage {
  type: "CHAT_MESSAGE_STREAMING_UPDATE";
  message: ChatMessage;
  messageIndex: number;
  timestamp: string;
}

// Solution workflow updates
export interface SolutionWorkflowUpdateMessage {
  type: "SOLUTION_WORKFLOW_UPDATE";
  isFetchingSolution: boolean;
  solutionState: SolutionState;
  solutionScope?: Scope;
  isWaitingForUserInteraction?: boolean;
  isProcessingQueuedMessages?: boolean;
  pendingBatchReview?: PendingBatchReviewFile[];
  timestamp: string;
}

// Server state updates
export interface ServerStateUpdateMessage {
  type: "SERVER_STATE_UPDATE";
  serverState: ServerState;
  isStartingServer: boolean;
  isInitializingServer: boolean;
  solutionServerConnected: boolean;
  profileSyncConnected: boolean;
  llmProxyAvailable: boolean;
  timestamp: string;
}

// Profile updates
export interface ProfilesUpdateMessage {
  type: "PROFILES_UPDATE";
  profiles: AnalysisProfile[];
  activeProfileId: string | null;
  isInTreeMode: boolean;
  timestamp: string;
}

// Configuration/errors updates
export interface ConfigErrorsUpdateMessage {
  type: "CONFIG_ERRORS_UPDATE";
  configErrors: ConfigError[];
  timestamp: string;
}

// Decorator updates (for diff views)
export interface DecoratorsUpdateMessage {
  type: "DECORATORS_UPDATE";
  activeDecorators: Record<string, string>;
  timestamp: string;
}

// Settings updates
export interface SettingsUpdateMessage {
  type: "SETTINGS_UPDATE";
  solutionServerEnabled: boolean;
  isAgentMode: boolean;
  isContinueInstalled: boolean;
  hubConfig?: HubConfig;
  profileSyncEnabled: boolean;
  isSyncingProfiles: boolean;
  llmProxyAvailable: boolean;
  timestamp: string;
}

/**
 * Union type of all possible webview messages
 */
export type WebviewMessage =
  | FullStateUpdateMessage
  | AnalysisStateUpdateMessage
  | ChatMessagesUpdateMessage
  | ChatMessageStreamingUpdateMessage
  | ChatStreamingChunkMessage
  | SolutionWorkflowUpdateMessage
  | ServerStateUpdateMessage
  | ProfilesUpdateMessage
  | ConfigErrorsUpdateMessage
  | DecoratorsUpdateMessage
  | SettingsUpdateMessage;

/**
 * Type guards for message discrimination
 */
export function isAnalysisStateUpdate(msg: WebviewMessage): msg is AnalysisStateUpdateMessage {
  return (msg as any).type === "ANALYSIS_STATE_UPDATE";
}

export function isChatMessagesUpdate(msg: WebviewMessage): msg is ChatMessagesUpdateMessage {
  return (msg as any).type === "CHAT_MESSAGES_UPDATE";
}

export function isChatMessageStreamingUpdate(
  msg: WebviewMessage,
): msg is ChatMessageStreamingUpdateMessage {
  return (msg as any).type === "CHAT_MESSAGE_STREAMING_UPDATE";
}

export function isChatStreamingChunk(msg: WebviewMessage): msg is ChatStreamingChunkMessage {
  return (msg as any).type === "CHAT_STREAMING_CHUNK";
}

export function isSolutionWorkflowUpdate(
  msg: WebviewMessage,
): msg is SolutionWorkflowUpdateMessage {
  return (msg as any).type === "SOLUTION_WORKFLOW_UPDATE";
}

export function isServerStateUpdate(msg: WebviewMessage): msg is ServerStateUpdateMessage {
  return (msg as any).type === "SERVER_STATE_UPDATE";
}

export function isProfilesUpdate(msg: WebviewMessage): msg is ProfilesUpdateMessage {
  return (msg as any).type === "PROFILES_UPDATE";
}

export function isConfigErrorsUpdate(msg: WebviewMessage): msg is ConfigErrorsUpdateMessage {
  return (msg as any).type === "CONFIG_ERRORS_UPDATE";
}

export function isDecoratorsUpdate(msg: WebviewMessage): msg is DecoratorsUpdateMessage {
  return (msg as any).type === "DECORATORS_UPDATE";
}

export function isSettingsUpdate(msg: WebviewMessage): msg is SettingsUpdateMessage {
  return (msg as any).type === "SETTINGS_UPDATE";
}

export function isFullStateUpdate(msg: WebviewMessage): msg is FullStateUpdateMessage {
  return (msg as any).type === MessageTypes.FULL_STATE_UPDATE;
}
