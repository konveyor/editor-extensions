import { GooseAgentState, GooseChatMessage, GooseContentBlockType, GooseConfig } from "./goose";

export const GooseMessageTypes = {
  GOOSE_STATE_CHANGE: "GOOSE_STATE_CHANGE",
  GOOSE_CHAT_STATE_CHANGE: "GOOSE_CHAT_STATE_CHANGE",
  GOOSE_CHAT_STREAMING_UPDATE: "GOOSE_CHAT_STREAMING_UPDATE",
  GOOSE_TOOL_CALL: "GOOSE_TOOL_CALL",
  GOOSE_CONFIG_UPDATE: "GOOSE_CONFIG_UPDATE",
} as const;

export type GooseMessageType = (typeof GooseMessageTypes)[keyof typeof GooseMessageTypes];

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

export interface GooseToolCallMessage {
  type: "GOOSE_TOOL_CALL";
  messageId: string;
  toolName: string;
  callId?: string;
  status: "running" | "succeeded" | "failed";
  result?: string;
  timestamp: string;
}

export interface GooseConfigUpdateMessage {
  type: "GOOSE_CONFIG_UPDATE";
  config: GooseConfig;
  timestamp: string;
}

export type GooseWebviewMessage =
  | GooseStateChangeMessage
  | GooseChatStateChangeMessage
  | GooseChatStreamingUpdateMessage
  | GooseToolCallMessage
  | GooseConfigUpdateMessage;

export function isGooseStateChange(msg: any): msg is GooseStateChangeMessage {
  return msg?.type === GooseMessageTypes.GOOSE_STATE_CHANGE;
}

export function isGooseChatStateChange(msg: any): msg is GooseChatStateChangeMessage {
  return msg?.type === GooseMessageTypes.GOOSE_CHAT_STATE_CHANGE;
}

export function isGooseChatStreamingUpdate(msg: any): msg is GooseChatStreamingUpdateMessage {
  return msg?.type === GooseMessageTypes.GOOSE_CHAT_STREAMING_UPDATE;
}

export function isGooseToolCall(msg: any): msg is GooseToolCallMessage {
  return msg?.type === GooseMessageTypes.GOOSE_TOOL_CALL;
}

export function isGooseConfigUpdate(msg: any): msg is GooseConfigUpdateMessage {
  return msg?.type === GooseMessageTypes.GOOSE_CONFIG_UPDATE;
}
