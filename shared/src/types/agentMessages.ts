import { AgentState, AgentChatMessage, AgentContentBlockType, AgentConfig } from "./agent";

export const AgentMessageTypes = {
  AGENT_STATE_CHANGE: "AGENT_STATE_CHANGE",
  AGENT_CHAT_STATE_CHANGE: "AGENT_CHAT_STATE_CHANGE",
  AGENT_CHAT_STREAMING_UPDATE: "AGENT_CHAT_STREAMING_UPDATE",
  AGENT_TOOL_CALL: "AGENT_TOOL_CALL",
  AGENT_CONFIG_UPDATE: "AGENT_CONFIG_UPDATE",
} as const;

export type AgentMessageType = (typeof AgentMessageTypes)[keyof typeof AgentMessageTypes];

export interface AgentStateChangeMessage {
  type: "AGENT_STATE_CHANGE";
  agentState: AgentState;
  agentError?: string;
  timestamp: string;
}

export interface AgentChatStateChangeMessage {
  type: "AGENT_CHAT_STATE_CHANGE";
  messages: AgentChatMessage[];
  timestamp: string;
}

export interface AgentChatStreamingUpdateMessage {
  type: "AGENT_CHAT_STREAMING_UPDATE";
  messageId: string;
  content: string;
  done: boolean;
  timestamp: string;
  contentType?: AgentContentBlockType;
  stopReason?: string;
  resourceUri?: string;
  resourceName?: string;
  resourceMimeType?: string;
  resourceContent?: string;
}

export interface AgentToolCallMessage {
  type: "AGENT_TOOL_CALL";
  messageId: string;
  toolName: string;
  callId?: string;
  status: "running" | "succeeded" | "failed";
  result?: string;
  timestamp: string;
}

export interface AgentConfigUpdateMessage {
  type: "AGENT_CONFIG_UPDATE";
  config: AgentConfig;
  timestamp: string;
}

export type AgentWebviewMessage =
  | AgentStateChangeMessage
  | AgentChatStateChangeMessage
  | AgentChatStreamingUpdateMessage
  | AgentToolCallMessage
  | AgentConfigUpdateMessage;

export function isAgentStateChange(msg: any): msg is AgentStateChangeMessage {
  return msg?.type === AgentMessageTypes.AGENT_STATE_CHANGE;
}

export function isAgentChatStateChange(msg: any): msg is AgentChatStateChangeMessage {
  return msg?.type === AgentMessageTypes.AGENT_CHAT_STATE_CHANGE;
}

export function isAgentChatStreamingUpdate(msg: any): msg is AgentChatStreamingUpdateMessage {
  return msg?.type === AgentMessageTypes.AGENT_CHAT_STREAMING_UPDATE;
}

export function isAgentToolCall(msg: any): msg is AgentToolCallMessage {
  return msg?.type === AgentMessageTypes.AGENT_TOOL_CALL;
}

export function isAgentConfigUpdate(msg: any): msg is AgentConfigUpdateMessage {
  return msg?.type === AgentMessageTypes.AGENT_CONFIG_UPDATE;
}

// Backward-compatible aliases
/** @deprecated Use AgentMessageTypes */
export const GooseMessageTypes = {
  GOOSE_STATE_CHANGE: AgentMessageTypes.AGENT_STATE_CHANGE,
  GOOSE_CHAT_STATE_CHANGE: AgentMessageTypes.AGENT_CHAT_STATE_CHANGE,
  GOOSE_CHAT_STREAMING_UPDATE: AgentMessageTypes.AGENT_CHAT_STREAMING_UPDATE,
  GOOSE_TOOL_CALL: AgentMessageTypes.AGENT_TOOL_CALL,
  GOOSE_CONFIG_UPDATE: AgentMessageTypes.AGENT_CONFIG_UPDATE,
} as const;
/** @deprecated Use AgentMessageType */
export type GooseMessageType = AgentMessageType;
/** @deprecated Use AgentStateChangeMessage */
export type GooseStateChangeMessage = AgentStateChangeMessage;
/** @deprecated Use AgentChatStateChangeMessage */
export type GooseChatStateChangeMessage = AgentChatStateChangeMessage;
/** @deprecated Use AgentChatStreamingUpdateMessage */
export type GooseChatStreamingUpdateMessage = AgentChatStreamingUpdateMessage;
/** @deprecated Use AgentToolCallMessage */
export type GooseToolCallMessage = AgentToolCallMessage;
/** @deprecated Use AgentConfigUpdateMessage */
export type GooseConfigUpdateMessage = AgentConfigUpdateMessage;
/** @deprecated Use AgentWebviewMessage */
export type GooseWebviewMessage = AgentWebviewMessage;
/** @deprecated Use isAgentStateChange */
export const isGooseStateChange = isAgentStateChange;
/** @deprecated Use isAgentChatStateChange */
export const isGooseChatStateChange = isAgentChatStateChange;
/** @deprecated Use isAgentChatStreamingUpdate */
export const isGooseChatStreamingUpdate = isAgentChatStreamingUpdate;
/** @deprecated Use isAgentToolCall */
export const isGooseToolCall = isAgentToolCall;
/** @deprecated Use isAgentConfigUpdate */
export const isGooseConfigUpdate = isAgentConfigUpdate;
