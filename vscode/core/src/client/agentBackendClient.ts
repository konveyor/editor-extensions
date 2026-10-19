/**
 * AgentBackendClient: Shared interface and types for agent backend clients.
 *
 * Both AcpClient (ACP subprocess) and DirectLLMClient (direct LLM call)
 * implement this interface so the orchestrator can use a single code path.
 */

import type { EventEmitter } from "events";
import type { AgentState } from "@editor-extensions/shared";

// ─── Shared types ────────────────────────────────────────────────────

export interface ToolCallData {
  name: string;
  callId?: string;
  arguments?: Record<string, unknown>;
  /**
   * File paths the ACP `locations` field names. Some agents (OpenCode) send
   * an empty `tool_call` and only fill in rawInput/locations on later
   * `tool_call_update` events, so updates carry them too.
   */
  locations?: string[];
  status: "running" | "succeeded" | "failed";
  result?: string;
}

export interface SendMessageOptions {
  /**
   * Cancel and settle whichever prompt is active when this message's turn
   * comes, instead of waiting for it to finish on its own. Used by the chat
   * input's cancel-and-send.
   */
  replaceActive?: boolean;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface PermissionRequestData {
  requestId: number;
  toolCallId: string;
  title: string;
  toolName?: string;
  kind: string;
  status: string;
  rawInput?: Record<string, unknown>;
  /** File paths from the ACP `locations` field, when the agent sends them. */
  locations?: string[];
  options: PermissionOption[];
}

export interface StreamingResourceData {
  uri?: string;
  name?: string;
  mimeType?: string;
  text?: string;
}

export interface McpServerConfig {
  name: string;
  type: "stdio";
  command: string;
  args: string[];
  env?: Array<{ name: string; value: string }>;
}

// ─── Interface ───────────────────────────────────────────────────────

/**
 * Common interface for agent backend clients.
 *
 * Events emitted (both clients):
 * - `stateChange(state: AgentState)`
 * - `streamingChunk(messageId: string, content: string, contentType: AgentContentBlockType, resourceData?: StreamingResourceData)`
 * - `streamingComplete(messageId: string, stopReason: string)`
 * - `toolCall(messageId: string, data: ToolCallData)`
 * - `toolCallUpdate(messageId: string, data: ToolCallData)`
 * - `error(error: Error)`
 *
 * Events emitted (AcpClient only):
 * - `permissionRequest(data: PermissionRequestData)`
 */
export interface AgentBackendClient extends EventEmitter {
  getState(): AgentState;
  getSessionId(): string | null;
  isPromptActive(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
  createSession(): Promise<string>;
  /**
   * Send a prompt and resolve with its stop reason. Sends are serialized:
   * a call made while another prompt is active waits for that prompt to
   * settle (or, with `replaceActive`, cancels it) before going on the wire.
   */
  sendMessage(
    content: string,
    responseMessageId: string,
    options?: SendMessageOptions,
  ): Promise<string>;
  /**
   * Cancel the in-flight prompt. Implementations that stream asynchronously
   * resolve once the cancelled prompt has settled, so a caller doing
   * cancel-and-send can `await` it before the next `sendMessage`.
   */
  cancelGeneration(): void | Promise<void>;
  updateModelEnv(env: Record<string, string>): void;
  setMcpServers(servers: McpServerConfig[]): void;
  respondToRequest(requestId: number, result: unknown): void;
}
