/**
 * DirectLLMClient: Agent backend that calls the LLM directly.
 *
 * Used when agentMode is disabled (focused fix mode). Instead of delegating
 * to Goose/OpenCode, sends the migration prompt directly to the configured
 * LLM via KaiModelProvider, uses tool calling to get structured file
 * modifications, and emits synthetic permissionRequest events so the
 * existing diff/accept/reject UI works unchanged.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type winston from "winston";
import type { KaiModelProvider } from "@editor-extensions/agentic";
import type { AIMessageChunk } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import type {
  AgentClient,
  AgentState,
  McpServerConfig,
  PermissionRequestData,
} from "./agentClient";

// ─── Tool definition ────────────────────────────────────────────────

const WRITE_FILE_TOOL = {
  name: "write_file",
  description:
    "Write the complete updated content of a file to fix migration issues. " +
    "Always provide the COMPLETE file content, not just the changed lines.",
  schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "File path relative to the workspace root",
      },
      content: {
        type: "string",
        description: "The complete new content of the file",
      },
      description: {
        type: "string",
        description: "Brief description of the changes made",
      },
    },
    required: ["path", "content"],
  },
};

// ─── Types ──────────────────────────────────────────────────────────

interface WriteFileArgs {
  path: string;
  content: string;
  description?: string;
}

export interface DirectLLMClientConfig {
  modelProvider: KaiModelProvider;
  workspaceRoot: string;
  logger: winston.Logger;
}

// ─── Client ─────────────────────────────────────────────────────────

export class DirectLLMClient extends EventEmitter implements AgentClient {
  private readonly modelProvider: KaiModelProvider;
  private readonly workspaceRoot: string;
  private readonly logger: winston.Logger;
  private requestCounter = 0;
  private abortController: AbortController | null = null;
  private promptActive = false;

  constructor(config: DirectLLMClientConfig) {
    super();
    this.modelProvider = config.modelProvider;
    this.workspaceRoot = config.workspaceRoot;
    this.logger = config.logger;
  }

  // ─── Lifecycle (mostly no-ops for a stateless client) ─────────────

  async start(): Promise<void> {
    this.emit("stateChange", "running");
  }

  async stop(): Promise<void> {
    this.cancelGeneration();
    this.emit("stateChange", "stopped");
  }

  dispose(): void {
    this.cancelGeneration();
    this.removeAllListeners();
  }

  getState(): AgentState {
    return "running";
  }

  getSessionId(): string | null {
    return null;
  }

  async createSession(): Promise<string> {
    return uuidv4();
  }

  isPromptActive(): boolean {
    return this.promptActive;
  }

  cancelGeneration(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  updateModelEnv(_env: Record<string, string>): void {
    // Model provider is pre-configured; env changes require reconstruction
  }

  setMcpServers(_servers: McpServerConfig[]): void {
    // No MCP support in direct LLM mode
  }

  respondToRequest(_requestId: number, _result: unknown): void {
    // No-op — the LLM has already finished. File writing is handled
    // by the existing changeApplied/changeDiscarded commands.
  }

  // ─── Core: send prompt and process response ───────────────────────

  async sendMessage(content: string, responseMessageId: string): Promise<string> {
    this.promptActive = true;
    this.abortController = new AbortController();

    try {
      const supportsTools = this.modelProvider.toolCallsSupported();
      this.logger.info("DirectLLMClient: sending prompt", {
        contentLength: content.length,
        supportsTools,
      });

      if (supportsTools) {
        return await this.sendWithToolCalling(content, responseMessageId);
      }
      return await this.sendWithTextParsing(content, responseMessageId);
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        this.logger.info("DirectLLMClient: generation cancelled");
        return "cancelled";
      }
      throw err;
    } finally {
      this.promptActive = false;
      this.abortController = null;
    }
  }

  // ─── Tool-calling path ────────────────────────────────────────────

  private async sendWithToolCalling(content: string, messageId: string): Promise<string> {
    const modelWithTools = this.modelProvider.bindTools([WRITE_FILE_TOOL]);

    // Stream so text reasoning is visible in real-time (many models
    // return no text at all when using invoke() with tools).
    const stream = await modelWithTools.stream([new HumanMessage(content)]);

    // Accumulate chunks — LangChain's concat() merges tool_call_chunks
    let accumulated: AIMessageChunk | null = null;
    let hasTextContent = false;

    for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
      accumulated = accumulated ? accumulated.concat(chunk) : chunk;

      // Stream text content in real-time
      const text =
        typeof chunk.content === "string"
          ? chunk.content
          : Array.isArray(chunk.content)
            ? (chunk.content as Array<{ type: string; text?: string }>)
                .filter((b) => b.type === "text" && b.text)
                .map((b) => b.text!)
                .join("")
            : "";

      if (text) {
        hasTextContent = true;
        this.emit("streamingChunk", messageId, text, "text");
      }
    }

    // Extract tool calls from the accumulated response
    const toolCalls = accumulated?.tool_calls ?? [];
    this.logger.info("DirectLLMClient: stream complete", {
      toolCallCount: toolCalls.length,
      hasTextContent,
    });

    // Many models (OpenAI, Gemini) return only tool calls with no text
    // when tools are bound. Synthesize a brief summary so the user
    // sees what the LLM decided to do.
    if (!hasTextContent && toolCalls.length > 0) {
      const summaryLines = toolCalls
        .filter((tc) => tc.name === "write_file")
        .map((tc) => {
          const args = tc.args as WriteFileArgs;
          const desc = args.description ?? "applying migration fixes";
          return `**${this.normalizePath(args.path)}**: ${desc}`;
        });

      if (summaryLines.length > 0) {
        const summary = summaryLines.join("\n\n");
        this.emit("streamingChunk", messageId, summary, "text");
      }
    }

    for (const toolCall of toolCalls) {
      if (toolCall.name === "write_file") {
        const args = toolCall.args as WriteFileArgs;
        await this.emitFileChange(messageId, args);
      }
    }

    this.emit("streamingComplete", messageId, "end_turn");
    return "end_turn";
  }

  // ─── Text-parsing fallback (no tool calling) ──────────────────────

  private async sendWithTextParsing(content: string, messageId: string): Promise<string> {
    // Add instruction for structured output
    const augmentedContent =
      content +
      "\n\n" +
      "IMPORTANT: For each file you modify, output the complete updated file " +
      "content in a fenced code block with the file path as the info string. Example:\n" +
      "```path/to/File.java\n" +
      "// complete file content here\n" +
      "```";

    const stream = await this.modelProvider.stream([new HumanMessage(augmentedContent)]);

    let fullText = "";
    for await (const chunk of stream as AsyncIterable<AIMessageChunk>) {
      const text = typeof chunk.content === "string" ? chunk.content : "";
      if (text) {
        fullText += text;
        this.emit("streamingChunk", messageId, text, "text");
      }
    }

    // Parse code fences with file paths
    const fileChanges = this.parseFileChangesFromText(fullText);
    this.logger.info("DirectLLMClient: parsed file changes from text", {
      count: fileChanges.length,
    });

    for (const change of fileChanges) {
      await this.emitFileChange(messageId, change);
    }

    this.emit("streamingComplete", messageId, "end_turn");
    return "end_turn";
  }

  private parseFileChangesFromText(text: string): WriteFileArgs[] {
    const changes: WriteFileArgs[] = [];
    // Match ```path/to/file.ext\n...content...\n```
    const fenceRegex = /```([^\n`]+\.[a-zA-Z0-9]+)\n([\s\S]*?)```/g;
    let match;

    while ((match = fenceRegex.exec(text)) !== null) {
      const filePath = match[1].trim();
      const content = match[2];
      // Skip if it looks like a language tag rather than a path
      if (filePath.includes("/") || filePath.includes("\\") || filePath.includes(".")) {
        // Additional check: skip common language tags
        const languageTags = new Set([
          "java",
          "xml",
          "json",
          "yaml",
          "yml",
          "properties",
          "diff",
          "bash",
          "shell",
          "sh",
          "sql",
          "html",
          "css",
          "js",
          "ts",
          "tsx",
          "jsx",
          "py",
          "go",
          "rs",
          "c",
          "cpp",
          "h",
          "cs",
        ]);
        if (!languageTags.has(filePath.toLowerCase())) {
          changes.push({ path: filePath, content });
        }
      }
    }

    return changes;
  }

  // ─── Emit synthetic permission request ────────────────────────────

  private normalizePath(filePath: string): string {
    const { relative, isAbsolute } = require("path");
    const wsRoot = this.workspaceRoot.startsWith("file://")
      ? new URL(this.workspaceRoot).pathname
      : this.workspaceRoot;

    if (isAbsolute(filePath)) {
      return relative(wsRoot, filePath) || filePath;
    }
    return filePath;
  }

  private async emitFileChange(messageId: string, args: WriteFileArgs): Promise<void> {
    const callId = `direct-${uuidv4()}`;
    const requestId = ++this.requestCounter;
    const filePath = this.normalizePath(args.path);

    // Emit tool call so it shows in the chat
    this.emit("toolCall", messageId, {
      name: "write_file",
      callId,
      arguments: { path: filePath, content: args.content },
      status: "running",
    });

    // Emit permission request — this triggers the diff UI
    const permissionData: PermissionRequestData = {
      requestId,
      toolCallId: callId,
      title: "Direct LLM: Text Editor",
      toolName: "text_editor",
      kind: "fileEditing",
      status: "pending",
      rawInput: {
        command: "write",
        path: filePath,
        file_text: args.content,
      },
      options: [
        { optionId: `allow-${callId}`, name: "Allow", kind: "allow_once" },
        { optionId: `reject-${callId}`, name: "Reject", kind: "reject_once" },
      ],
    };

    this.emit("permissionRequest", permissionData);

    // Mark tool call as succeeded (the permission handles the actual file write)
    this.emit("toolCallUpdate", messageId, {
      name: "write_file",
      callId,
      status: "succeeded",
      result: args.description ?? `Updated ${args.path}`,
    });
  }
}
