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

/**
 * Supervision mode for agent tool calls, mirroring the agentic platform's
 * AgentRun `execution.mode` (agentic-controller ADR 0011): `auto` approves
 * every tool call, `approve` asks before each one. Applied through ACP
 * session modes, so it only works with agents that advertise both ids
 * (Goose does; OpenCode's modes are its agents, not permissions).
 */
export type AgentPermissionMode = "auto" | "approve";

export const AGENT_PERMISSION_MODES: readonly AgentPermissionMode[] = ["approve", "auto"];

export function isAgentPermissionMode(value: unknown): value is AgentPermissionMode {
  return value === "auto" || value === "approve";
}

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
