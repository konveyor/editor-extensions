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
    const promptFilePaths = this.extractFilePathsFromPrompt(content);

    const augmentedContent =
      content +
      "\n\n" +
      "CRITICAL OUTPUT FORMAT: For EVERY file you modify, output the COMPLETE " +
      "updated file content in a fenced code block where the ONLY thing on " +
      "the opening fence line is the file path. " +
      "Do NOT use language tags like ```xml or ```java. Example:\n" +
      "```pom.xml\n" +
      "<!-- complete file content here -->\n" +
      "```\n" +
      "Another example:\n" +
      "```src/main/java/com/example/MyClass.java\n" +
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

    const fileChanges = this.parseFileChangesFromText(fullText, promptFilePaths);
    this.logger.info("DirectLLMClient: parsed file changes from text", {
      count: fileChanges.length,
      promptFilePaths,
    });

    if (fileChanges.length === 0) {
      const codeBlockCount = Math.floor((fullText.match(/```/g)?.length ?? 0) / 2);
      if (codeBlockCount > 0) {
        this.logger.warn(
          "DirectLLMClient: found code blocks but could not extract file paths — " +
            "the LLM may not have followed the structured output format",
          { codeBlockCount, promptFilePaths },
        );
      }
    }

    for (const change of fileChanges) {
      await this.emitFileChange(messageId, change);
    }

    this.emit("streamingComplete", messageId, "end_turn");
    return "end_turn";
  }

  /**
   * Extract file paths from the prompt headings produced by buildMigrationPrompt.
   * These are `### path/to/file.ext` lines that tell us which files the LLM
   * was asked to modify.
   */
  private extractFilePathsFromPrompt(prompt: string): string[] {
    const paths: string[] = [];
    const headingRegex = /^### (\S+)$/gm;
    let match;
    while ((match = headingRegex.exec(prompt)) !== null) {
      if (this.looksLikeFilePath(match[1])) {
        paths.push(match[1]);
      }
    }
    return paths;
  }

  // ─── Text-parsing helpers ────────────────────────────────────────

  private static readonly LANGUAGE_TAGS = new Set([
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
    "kotlin",
    "groovy",
    "scala",
    "ruby",
    "rb",
    "php",
    "swift",
    "md",
    "markdown",
    "text",
    "txt",
    "toml",
    "ini",
    "dockerfile",
    "makefile",
    "plaintext",
  ]);

  private parseFileChangesFromText(text: string, promptFilePaths: string[] = []): WriteFileArgs[] {
    const changes: WriteFileArgs[] = [];
    const seen = new Set<string>();

    const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g;
    let match;

    while ((match = fencePattern.exec(text)) !== null) {
      const infoString = match[1].trim();
      const content = match[2];
      const blockStart = match.index;

      const filePath = this.resolveFilePath(infoString, content, text, blockStart, promptFilePaths);

      if (filePath && !seen.has(filePath)) {
        seen.add(filePath);
        changes.push({
          path: filePath,
          content: this.stripFilePathHeader(content, filePath),
        });
      }
    }

    return changes;
  }

  private static readonly LANG_TO_EXTENSIONS: Record<string, string[]> = {
    java: [".java"],
    xml: [".xml", ".pom", ".xsd", ".xsl"],
    json: [".json"],
    yaml: [".yaml", ".yml"],
    yml: [".yaml", ".yml"],
    properties: [".properties"],
    html: [".html", ".htm"],
    css: [".css"],
    js: [".js", ".mjs", ".cjs"],
    ts: [".ts", ".mts", ".cts"],
    tsx: [".tsx"],
    jsx: [".jsx"],
    py: [".py"],
    go: [".go"],
    rs: [".rs"],
    kotlin: [".kt", ".kts"],
    groovy: [".groovy"],
    scala: [".scala"],
    ruby: [".rb"],
    rb: [".rb"],
    php: [".php"],
    swift: [".swift"],
    cs: [".cs"],
    c: [".c"],
    cpp: [".cpp", ".cc", ".cxx"],
    h: [".h", ".hpp"],
    sql: [".sql"],
    sh: [".sh"],
    bash: [".sh", ".bash"],
    shell: [".sh"],
    dockerfile: ["Dockerfile"],
    makefile: ["Makefile"],
    toml: [".toml"],
    ini: [".ini"],
    md: [".md"],
    markdown: [".md"],
  };

  /**
   * Try multiple strategies to determine which file a code block belongs to.
   */
  private resolveFilePath(
    infoString: string,
    content: string,
    fullText: string,
    blockStart: number,
    promptFilePaths: string[] = [],
  ): string | undefined {
    // Strategy 1: info string IS a file path (e.g. ```src/main/java/MyClass.java)
    if (this.looksLikeFilePath(infoString)) {
      return infoString;
    }

    // Strategy 2: info string is "lang:path" or "lang path/to/file"
    // e.g. ```java:src/main/java/MyClass.java  or  ```java src/MyClass.java
    const separatorMatch = infoString.match(/^\w+[:\s]+(.+)$/);
    if (separatorMatch) {
      const candidate = separatorMatch[1].trim();
      if (this.looksLikeFilePath(candidate)) {
        return candidate;
      }
    }

    // Strategy 3: first line of content is a file-path comment
    // e.g. // File: src/main/java/MyClass.java  or  # src/config.yaml
    const firstLine = content.split("\n")[0]?.trim() ?? "";
    const commentMatch = firstLine.match(/^(?:\/\/|#|\/\*|\*|<!--)\s*(?:File:\s*)?(\S+\.\w+)/);
    if (commentMatch && this.looksLikeFilePath(commentMatch[1])) {
      return commentMatch[1];
    }

    const preceding = fullText.substring(Math.max(0, blockStart - 300), blockStart);

    // Strategy 4: preceding text mentions a file path in backticks
    // e.g. "Here is the updated `pom.xml`:" or "`src/main/java/MyClass.java`"
    const backtickPaths = [...preceding.matchAll(/`([^`]+\.\w+)`/g)];
    if (backtickPaths.length > 0) {
      const lastMention = backtickPaths[backtickPaths.length - 1][1];
      if (this.looksLikeFilePath(lastMention)) {
        return lastMention;
      }
    }

    // Strategy 5: preceding text mentions a bare filename near the code block
    // e.g. "Here is the updated pom.xml:" or "Modified MyClass.java below"
    const bareFileMatch = [...preceding.matchAll(/\b([\w./-]+\.\w{1,10})\b/g)].filter((m) =>
      this.looksLikeFilePath(m[1]),
    );
    if (bareFileMatch.length > 0) {
      return bareFileMatch[bareFileMatch.length - 1][1];
    }

    // Strategy 6: match the code block's language tag to known prompt file paths
    // e.g. ```xml code block + prompt mentions "pom.xml" → match by extension
    if (promptFilePaths.length > 0 && infoString) {
      const lang = infoString.toLowerCase().split(/\s/)[0];
      const extensions = DirectLLMClient.LANG_TO_EXTENSIONS[lang];
      if (extensions) {
        const match = promptFilePaths.find((p) => extensions.some((ext) => p.endsWith(ext)));
        if (match) {
          return match;
        }
      }
    }

    // Strategy 7: single code block with single prompt file — assume it's the target
    if (promptFilePaths.length === 1) {
      return promptFilePaths[0];
    }

    return undefined;
  }

  private looksLikeFilePath(s: string): boolean {
    if (!s || s.length < 3) {
      return false;
    }
    if (!/\.\w{1,10}$/.test(s)) {
      return false;
    }
    if (DirectLLMClient.LANGUAGE_TAGS.has(s.toLowerCase())) {
      return false;
    }
    return true;
  }

  /**
   * Remove a first-line comment that only served to identify the file path.
   */
  private stripFilePathHeader(content: string, filePath: string): string {
    const lines = content.split("\n");
    if (lines.length > 0) {
      const first = lines[0].trim();
      if (/^(?:\/\/|#|\/\*|\*|<!--)\s*(?:File:\s*)?/.test(first) && first.includes(filePath)) {
        return lines.slice(1).join("\n");
      }
    }
    return content;
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
