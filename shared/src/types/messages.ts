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
} from "./types";
import type { AgentWebviewMessage } from "./agentMessages";

export const MessageTypes = {
  // Core state
  STATE_CHANGE: "STATE_CHANGE",
  FOCUS_VIOLATION: "FOCUS_VIOLATION",

  // Chat (kai resolution workflow)
  CHAT_STATE_CHANGE: "CHAT_STATE_CHANGE",
  CHAT_STREAMING_UPDATE: "CHAT_STREAMING_UPDATE",
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
  isBatchReviewMode?: boolean;
  pendingBatchReview?: PendingBatchReviewFile[];
  experimentalChatEnabled?: boolean;
  modelSupportsTools?: boolean;

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
  isContinueInstalled?: boolean;
  hubConfig?: HubConfig;
  hubForced?: boolean;
  profileSyncEnabled?: boolean;
  isSyncingProfiles?: boolean;

  // Labels
  availableTargets?: string[];
  availableSources?: string[];
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

/**
 * Union type of all possible webview messages (core + agent)
 */
export type WebviewMessage =
  | StateChangeMessage
  | FocusViolationMessage
  | ChatStateChangeMessage
  | ChatStreamingUpdateMessage
  | AgentWebviewMessage;

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
