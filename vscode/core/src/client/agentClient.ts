/**
 * AgentClient: Pluggable interface for AI agent backends.
 *
 * Both GooseClient (ACP over stdio) and OpencodeAgentClient (@opencode-ai/sdk)
 * implement this interface, allowing the extension to switch backends via
 * configuration without changing orchestration or handler code.
 */

import { EventEmitter } from "events";
import type { AgentContentBlockType } from "@editor-extensions/shared";
import type { KaiInteractiveWorkflow } from "@editor-extensions/agentic";

// ─── Shared types ────────────────────────────────────────────────────

export type AgentState = "stopped" | "starting" | "running" | "error";

export interface StreamingResourceData {
  uri?: string;
  name?: string;
  mimeType?: string;
  text?: string;
}

export interface ToolCallData {
  name: string;
  callId?: string;
  arguments?: Record<string, unknown>;
  status: "running" | "succeeded" | "failed";
  result?: string;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface PermissionRequestData {
  requestId: number;
  toolCallId: string;
  /** Human-readable description of the permission request */
  title: string;
  /** The actual tool name (e.g. "text_editor", "bash") for classifier matching */
  toolName?: string;
  kind: string;
  status: string;
  rawInput?: Record<string, unknown>;
  options: PermissionOption[];
}

// ─── MCP server configuration ────────────────────────────────────────

export interface McpServerConfig {
  name: string;
  type: "stdio";
  command: string;
  args: string[];
  env?: Array<{ name: string; value: string }>;
}

// ─── Event signatures ────────────────────────────────────────────────

export interface AgentClientEvents {
  stateChange: (state: AgentState) => void;
  streamingChunk: (
    messageId: string,
    content: string,
    contentType: AgentContentBlockType,
    resourceData?: StreamingResourceData,
  ) => void;
  streamingComplete: (messageId: string, stopReason: string) => void;
  toolCall: (messageId: string, data: ToolCallData) => void;
  toolCallUpdate: (messageId: string, data: ToolCallData) => void;
  permissionRequest: (data: PermissionRequestData) => void;
  error: (error: Error) => void;
}

// ─── AgentClient interface ───────────────────────────────────────────

export interface AgentClient extends EventEmitter {
  /** Start the agent: discover binary / connect, initialize protocol, create session. */
  start(): Promise<void>;

  /** Stop the agent and clean up subprocess / connections. */
  stop(): Promise<void>;

  /** Dispose all resources. */
  dispose(): void;

  /** Send a user message and stream the response. Returns the stop reason. */
  sendMessage(content: string, responseMessageId: string): Promise<string>;

  /** Create a new session, replacing the active one. */
  createSession(): Promise<string>;

  /** Cancel the current generation. */
  cancelGeneration(): void;

  /** Current agent state. */
  getState(): AgentState;

  /** Current session ID, if any. */
  getSessionId(): string | null;

  /** Whether a prompt is currently in flight. */
  isPromptActive(): boolean;

  /** Update environment variables for model authentication. Takes effect on next start(). */
  updateModelEnv(env: Record<string, string>): void;

  /** Set MCP server configurations. Must be called before start(). */
  setMcpServers(servers: McpServerConfig[]): void;

  /** Respond to an incoming request from the agent (e.g. permission request). */
  respondToRequest(requestId: number, result: unknown): void;

  /** Return the underlying workflow, if this client wraps one (e.g. DirectLLMClient). */
  getWorkflow?(): KaiInteractiveWorkflow;
}
