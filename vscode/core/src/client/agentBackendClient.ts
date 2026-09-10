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
  title: string;
  toolName?: string;
  kind: string;
  status: string;
  rawInput?: Record<string, unknown>;
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
  sendMessage(content: string, responseMessageId: string): Promise<string>;
  cancelGeneration(): void;
  updateModelEnv(env: Record<string, string>): void;
  setMcpServers(servers: McpServerConfig[]): void;
  respondToRequest(requestId: number, result: unknown): void;
}
