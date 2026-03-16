import type { ToolPermissionPolicy } from "./toolPermissions";

// ─── Agent backend types ────────────────────────────────────────────

/** Supported agent backends */
export type AgentBackend = "goose" | "opencode" | "claude" | "codex";

/** Agent lifecycle state */
export type AgentState = "stopped" | "starting" | "running" | "error";

// ─── Agent capabilities ─────────────────────────────────────────────

/** Backend-agnostic capability (Goose extension, OpenCode plugin, etc.) */
export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Backend-specific type hint — the UI doesn't interpret this */
  kind?: string;
}

// ─── Agent configuration ─────────────────────────────────────────────

/**
 * Backend-agnostic configuration for the Configuration panel.
 *
 * The UI renders provider/model/credentials, tool permissions, and
 * backend-specific capabilities regardless of which agent backend is active.
 */
export interface AgentConfig {
  /** Which backend is active */
  backend: AgentBackend;
  /**
   * When true, the agent has full autonomy to explore, iterate, and fix broadly.
   * When false, the agent does a focused fix on specific incidents only.
   */
  agentMode: boolean;
  provider: string;
  model: string;
  hasStoredCredentials: boolean;
  /** Backend-specific capabilities (Goose extensions, OpenCode plugins, etc.) */
  capabilities: AgentCapability[];
  /** Current tool permission policy */
  toolPermissions: ToolPermissionPolicy;
  /** Path to the backend's native config file (for "Advanced" link) */
  nativeConfigPath?: string;
}

// ─── Agent chat types ────────────────────────────────────────────────

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
