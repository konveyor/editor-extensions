// --- Goose agent types (experimental chat) ---

export interface GooseExtensionConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  type: "platform" | "builtin" | "stdio";
  bundled: boolean;
}

export interface GooseConfig {
  provider: string;
  model: string;
  extensions: GooseExtensionConfig[];
  hasStoredCredentials: boolean;
}

export type GooseAgentState = "stopped" | "starting" | "running" | "error";

export type GooseContentBlockType = "text" | "resource_link" | "resource" | "thinking";

export type GooseContentBlock =
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

export interface GooseChatMessage {
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
  contentBlocks?: GooseContentBlock[];
  isThinking?: boolean;
  isCancelled?: boolean;
  stopReason?: string;
}
