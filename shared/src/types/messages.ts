import {
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
  GooseAgentState,
  GooseChatMessage,
  GooseContentBlockType,
} from "./types";

export const MessageTypes = {
  // Core state
  STATE_CHANGE: "STATE_CHANGE",
  FOCUS_VIOLATION: "FOCUS_VIOLATION",

  // Chat (kai resolution workflow)
  CHAT_STATE_CHANGE: "CHAT_STATE_CHANGE",
  CHAT_STREAMING_UPDATE: "CHAT_STREAMING_UPDATE",

  // Goose (experimental)
  GOOSE_STATE_CHANGE: "GOOSE_STATE_CHANGE",
  GOOSE_CHAT_STATE_CHANGE: "GOOSE_CHAT_STATE_CHANGE",
  GOOSE_CHAT_STREAMING_UPDATE: "GOOSE_CHAT_STREAMING_UPDATE",
} as const;

export type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes];

/**
 * Message types for VSCode extension -> Webview communication
 */

// Chat state change (full array replacement)
export interface ChatStateChangeMessage {
  type: "CHAT_STATE_CHANGE";
  chatMessages: ChatMessage[];
  previousLength: number;
  timestamp: string;
}

// Chat streaming update (incremental — just one message)
export interface ChatStreamingUpdateMessage {
  type: "CHAT_STREAMING_UPDATE";
  message: ChatMessage;
  messageIndex: number;
  timestamp: string;
}

export interface StateChangeData {
  // Analysis
  ruleSets?: RuleSet[];
  enhancedIncidents?: EnhancedIncident[];
  isAnalyzing?: boolean;
  isAnalysisScheduled?: boolean;
  analysisProgress?: number;
  analysisProgressMessage?: string;

  // Solution workflow
  isFetchingSolution?: boolean;
  solutionState?: SolutionState;
  solutionScope?: Scope;
  isWaitingForUserInteraction?: boolean;
  isProcessingQueuedMessages?: boolean;
  pendingBatchReview?: PendingBatchReviewFile[];

  // Server
  serverState?: ServerState;
  isStartingServer?: boolean;
  isInitializingServer?: boolean;
  solutionServerConnected?: boolean;
  profileSyncConnected?: boolean;
  llmProxyAvailable?: boolean;

  // Profiles
  profiles?: AnalysisProfile[];
  activeProfileId?: string | null;
  isInTreeMode?: boolean;

  // Config errors
  configErrors?: ConfigError[];

  // Decorators
  activeDecorators?: Record<string, string>;

  // Settings
  solutionServerEnabled?: boolean;
  isAgentMode?: boolean;
  isContinueInstalled?: boolean;
  hubConfig?: HubConfig;
  hubForced?: boolean;
  profileSyncEnabled?: boolean;
  isSyncingProfiles?: boolean;
}

export interface StateChangeMessage {
  type: "STATE_CHANGE";
  data: StateChangeData;
  timestamp: string;
}

export interface FocusViolationMessage {
  type: "FOCUS_VIOLATION";
  violationId: string;
  violationMessage: string;
  timestamp: string;
}

// --- Goose (experimental) ---

export interface GooseStateChangeMessage {
  type: "GOOSE_STATE_CHANGE";
  gooseState: GooseAgentState;
  gooseError?: string;
  timestamp: string;
}

export interface GooseChatStateChangeMessage {
  type: "GOOSE_CHAT_STATE_CHANGE";
  messages: GooseChatMessage[];
  timestamp: string;
}

export interface GooseChatStreamingUpdateMessage {
  type: "GOOSE_CHAT_STREAMING_UPDATE";
  messageId: string;
  content: string;
  done: boolean;
  timestamp: string;
  contentType?: GooseContentBlockType;
  stopReason?: string;
  resourceUri?: string;
  resourceName?: string;
  resourceMimeType?: string;
  resourceContent?: string;
}

/**
 * Union type of all possible webview messages
 */
export type WebviewMessage =
  | StateChangeMessage
  | FocusViolationMessage
  | ChatStateChangeMessage
  | ChatStreamingUpdateMessage
  | GooseStateChangeMessage
  | GooseChatStateChangeMessage
  | GooseChatStreamingUpdateMessage;

/**
 * Type guards for message discrimination
 */
// Core
export function isStateChange(msg: WebviewMessage): msg is StateChangeMessage {
  return (msg as any).type === MessageTypes.STATE_CHANGE;
}

export function isFocusViolation(msg: WebviewMessage): msg is FocusViolationMessage {
  return (msg as any).type === MessageTypes.FOCUS_VIOLATION;
}

// Chat
export function isChatStateChange(msg: WebviewMessage): msg is ChatStateChangeMessage {
  return (msg as any).type === MessageTypes.CHAT_STATE_CHANGE;
}

export function isChatStreamingUpdate(msg: WebviewMessage): msg is ChatStreamingUpdateMessage {
  return (msg as any).type === MessageTypes.CHAT_STREAMING_UPDATE;
}

// Goose
export function isGooseStateChange(msg: WebviewMessage): msg is GooseStateChangeMessage {
  return (msg as any).type === MessageTypes.GOOSE_STATE_CHANGE;
}

export function isGooseChatStateChange(msg: WebviewMessage): msg is GooseChatStateChangeMessage {
  return (msg as any).type === MessageTypes.GOOSE_CHAT_STATE_CHANGE;
}

export function isGooseChatStreamingUpdate(
  msg: WebviewMessage,
): msg is GooseChatStreamingUpdateMessage {
  return (msg as any).type === MessageTypes.GOOSE_CHAT_STREAMING_UPDATE;
}
