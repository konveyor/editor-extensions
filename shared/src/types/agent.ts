// --- Agent types (pluggable backend: goose, opencode, kai) ---

export interface AgentExtensionConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  type: "platform" | "builtin" | "stdio";
  bundled: boolean;
}

export interface AgentConfig {
  provider: string;
  model: string;
  extensions: AgentExtensionConfig[];
  hasStoredCredentials: boolean;
}

export type AgentState = "stopped" | "starting" | "running" | "error";

export type AgentContentBlockType = "text" | "resource_link" | "resource" | "thinking";

export type AgentContentBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name?: string; mimeType?: string }
  | {
      type: "resource";
      uri: string;
      name?: string;
      mimeType?: string;
      text?: string;
      blob?: string;
    }
  | { type: "thinking"; text: string };

export interface AgentChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  toolCall?: {
    name: string;
    arguments?: Record<string, unknown>;
    status: "pending" | "running" | "succeeded" | "failed";
    result?: string;
  };
  isStreaming?: boolean;
  contentBlocks?: AgentContentBlock[];
  isThinking?: boolean;
  isCancelled?: boolean;
  stopReason?: string;
}

// Backward-compatible aliases
/** @deprecated Use AgentExtensionConfig */
export type GooseExtensionConfig = AgentExtensionConfig;
/** @deprecated Use AgentConfig */
export type GooseConfig = AgentConfig;
/** @deprecated Use AgentState */
export type GooseAgentState = AgentState;
/** @deprecated Use AgentContentBlockType */
export type GooseContentBlockType = AgentContentBlockType;
/** @deprecated Use AgentContentBlock */
export type GooseContentBlock = AgentContentBlock;
/** @deprecated Use AgentChatMessage */
export type GooseChatMessage = AgentChatMessage;
