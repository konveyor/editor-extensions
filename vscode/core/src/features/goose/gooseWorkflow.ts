import { EventEmitter } from "events";
import * as fs from "fs/promises";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import type winston from "winston";
import type {
  KaiWorkflow,
  KaiWorkflowInitOptions,
  KaiWorkflowResponse,
  KaiWorkflowMessage,
  KaiUserInteractionMessage,
  KaiModifiedFile,
} from "@editor-extensions/agentic";
import { KaiWorkflowMessageType } from "@editor-extensions/agentic";
import type { KaiInteractiveWorkflowInput } from "@editor-extensions/agentic";
import type { GooseClient, ToolCallData } from "../../client/gooseClient";
import type { GooseContentBlockType } from "@editor-extensions/shared";
import { buildMigrationPrompt } from "./goosePromptBuilder";

/**
 * Adapter that implements KaiWorkflow by delegating to a GooseClient.
 *
 * Translates goose streaming events into KaiWorkflowMessage emissions
 * so the existing SolutionWorkflowOrchestrator, processMessage pipeline,
 * and ResolutionsPage UI work unchanged.
 */
export class GooseWorkflow implements KaiWorkflow<KaiInteractiveWorkflowInput> {
  private readonly events = new EventEmitter();
  private workspaceDir = "";
  private modifiedFiles: KaiModifiedFile[] = [];
  /** Caches original file content BEFORE Goose modifies it, keyed by absolute path. */
  private readonly originalContentCache = new Map<string, string>();

  constructor(
    private readonly gooseClient: GooseClient,
    private readonly logger: winston.Logger,
  ) {}

  // ─── KaiWorkflowEvents ──────────────────────────────────────────────

  on(event: "workflowMessage", listener: (msg: KaiWorkflowMessage) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    this.events.on(event, listener);
    return this;
  }

  removeAllListeners(): void {
    this.events.removeAllListeners();
  }

  private emitWorkflowMessage(msg: KaiWorkflowMessage): void {
    this.events.emit("workflowMessage", msg);
  }

  // ─── KaiWorkflow implementation ─────────────────────────────────────

  async init(options: KaiWorkflowInitOptions): Promise<void> {
    this.workspaceDir = options.workspaceDir;

    if (this.gooseClient.getState() !== "running") {
      this.logger.info("GooseWorkflow: goose client not running, attempting to start");
      await this.gooseClient.start();
    }
  }

  async run(input: KaiInteractiveWorkflowInput): Promise<KaiWorkflowResponse> {
    this.modifiedFiles = [];
    this.originalContentCache.clear();
    const errors: Error[] = [];

    // Pre-read all incident files BEFORE Goose modifies them so we have
    // original content for diffs and can revert on reject.
    await this.cacheIncidentFileContents(input);

    const prompt = await buildMigrationPrompt(input, this.workspaceDir);
    const acpRequestId = uuidv4();
    let currentTextMessageId = uuidv4();

    const onChunk = (
      _msgId: string,
      content: string,
      contentType: GooseContentBlockType,
      resourceData?: { uri?: string; name?: string; mimeType?: string; text?: string },
    ): void => {
      switch (contentType) {
        case "text":
          if (content) {
            this.emitWorkflowMessage({
              type: KaiWorkflowMessageType.LLMResponseChunk,
              id: currentTextMessageId,
              data: { content } as any,
            });
          }
          break;
        case "thinking":
          if (content) {
            this.emitWorkflowMessage({
              type: KaiWorkflowMessageType.LLMResponseChunk,
              id: currentTextMessageId,
              data: { content: `> ${content}\n` } as any,
            });
          }
          break;
        case "resource_link":
          this.logger.debug("GooseWorkflow: resource_link chunk received", {
            uri: resourceData?.uri,
            name: resourceData?.name,
          });
          if (resourceData?.uri) {
            this.emitWorkflowMessage({
              type: KaiWorkflowMessageType.LLMResponseChunk,
              id: currentTextMessageId,
              data: {
                content: `[Resource: ${resourceData.name || resourceData.uri}](${resourceData.uri})\n`,
              } as any,
            });
          }
          break;
        case "resource":
          this.logger.debug("GooseWorkflow: resource chunk received", {
            uri: resourceData?.uri,
            name: resourceData?.name,
            hasText: !!resourceData?.text,
          });
          if (resourceData?.text) {
            this.emitWorkflowMessage({
              type: KaiWorkflowMessageType.LLMResponseChunk,
              id: currentTextMessageId,
              data: { content: resourceData.text } as any,
            });
          }
          break;
        default:
          this.logger.warn("GooseWorkflow: unhandled streaming content type", {
            contentType,
            hasContent: !!content,
            contentLength: content?.length,
          });
          break;
      }
    };

    // Cache tool arguments from toolCall so they're available in toolCallUpdate
    const toolCallArgsCache = new Map<string, Record<string, unknown>>();

    const onToolCall = (_msgId: string, data: ToolCallData): void => {
      this.logger.debug("GooseWorkflow: toolCall received", {
        name: data.name,
        callId: data.callId,
        status: data.status,
        hasArguments: !!data.arguments,
      });
      const callId = data.callId ?? uuidv4();

      if (data.arguments) {
        toolCallArgsCache.set(callId, data.arguments);

        // Pre-read the target file BEFORE the tool executes (tool_call fires
        // before execution). This captures the original content for files
        // Goose modifies that weren't in the incident scope.
        this.tryCacheOriginalContent(data.name, data.arguments);
      }

      this.emitWorkflowMessage({
        type: KaiWorkflowMessageType.ToolCall,
        id: callId,
        data: {
          id: callId,
          name: data.name,
          args: data.arguments ? JSON.stringify(data.arguments) : undefined,
          status:
            data.status === "succeeded"
              ? "succeeded"
              : data.status === "failed"
                ? "failed"
                : "running",
        },
      });
      currentTextMessageId = uuidv4();
    };

    const onToolCallUpdate = (_msgId: string, data: ToolCallData): void => {
      const callId = data.callId ?? uuidv4();

      // Merge cached arguments from the initial toolCall event
      if (!data.arguments && toolCallArgsCache.has(callId)) {
        data = { ...data, arguments: toolCallArgsCache.get(callId) };
      }
      toolCallArgsCache.delete(callId);

      this.logger.debug("GooseWorkflow: toolCallUpdate received", {
        name: data.name,
        callId: data.callId,
        status: data.status,
        hasResult: !!data.result,
        hasArguments: !!data.arguments,
      });

      this.emitWorkflowMessage({
        type: KaiWorkflowMessageType.ToolCall,
        id: callId,
        data: {
          id: callId,
          name: data.name,
          status:
            data.status === "succeeded"
              ? "succeeded"
              : data.status === "failed"
                ? "failed"
                : "running",
          result: data.result,
        },
      });

      if (data.status === "succeeded") {
        this.tryExtractModifiedFile(data);
      }
    };

    const onStreamingComplete = (_msgId: string, stopReason: string): void => {
      this.logger.info("GooseWorkflow: streaming complete", { messageId: _msgId, stopReason });
    };

    this.gooseClient.on("streamingChunk", onChunk);
    this.gooseClient.on("toolCall", onToolCall);
    this.gooseClient.on("toolCallUpdate", onToolCallUpdate);
    this.gooseClient.on("streamingComplete", onStreamingComplete);

    try {
      const stopReason = await this.gooseClient.sendMessage(prompt, acpRequestId);

      this.emitWorkflowMessage({
        type: KaiWorkflowMessageType.LLMResponse,
        id: acpRequestId,
        data: { content: `[Goose completed: ${stopReason}]` } as any,
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      errors.push(error);
      this.emitWorkflowMessage({
        type: KaiWorkflowMessageType.Error,
        id: uuidv4(),
        data: error.message,
      });
    } finally {
      this.gooseClient.removeListener("streamingChunk", onChunk);
      this.gooseClient.removeListener("toolCall", onToolCall);
      this.gooseClient.removeListener("toolCallUpdate", onToolCallUpdate);
      this.gooseClient.removeListener("streamingComplete", onStreamingComplete);
    }

    return { modified_files: this.modifiedFiles, errors };
  }

  async resolveUserInteraction(response: KaiUserInteractionMessage): Promise<void> {
    const interaction = response.data;
    let followUp: string;

    if (interaction.type === "yesNo") {
      followUp = interaction.response?.yesNo ? "Yes, please continue." : "No, stop here.";
    } else if (interaction.type === "choice" && interaction.response?.choice !== undefined) {
      const choices = interaction.systemMessage.choice ?? [];
      followUp = choices[interaction.response.choice] ?? "Selected option.";
    } else {
      followUp = "Acknowledged.";
    }

    const replyId = uuidv4();
    await this.gooseClient.sendMessage(followUp, replyId);
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Heuristic: if a tool that modifies files succeeded, extract the file path
   * and content from its arguments/result and emit a ModifiedFile message.
   *
   * Handles Goose built-in tools like developer__text_editor (str_replace,
   * create, insert commands) and developer__write_file, as well as any
   * MCP tool whose name contains write/save/edit/create/replace/patch.
   */
  private tryExtractModifiedFile(data: ToolCallData): void {
    const name = data.name?.toLowerCase() ?? "";
    const isFileModifyingTool =
      name.includes("write") ||
      name.includes("save") ||
      name.includes("edit") ||
      name.includes("text_editor") ||
      name.includes("create") ||
      name.includes("replace") ||
      name.includes("patch");

    if (!isFileModifyingTool) {
      return;
    }

    const args = data.arguments ?? {};

    // text_editor "view" and "undo_edit" commands don't produce new content
    const command = args.command as string | undefined;
    if (command === "view" || command === "undo_edit") {
      return;
    }

    const filePath = (args.path ?? args.file_path ?? args.filename) as string | undefined;
    // Goose text_editor uses new_str; write_file uses content
    const content = (args.content ?? args.new_str ?? args.text ?? data.result) as
      | string
      | undefined;

    if (!filePath || !content) {
      this.logger.debug("GooseWorkflow: tryExtractModifiedFile - missing path or content", {
        toolName: data.name,
        hasPath: !!filePath,
        hasContent: !!content,
        argKeys: Object.keys(args),
      });
      return;
    }

    const absPath = path.isAbsolute(filePath) ? filePath : path.join(this.workspaceDir, filePath);
    const originalContent = this.originalContentCache.get(absPath);

    const modifiedFile: KaiModifiedFile = {
      path: filePath,
      content,
      originalContent,
    };
    this.modifiedFiles.push(modifiedFile);

    this.emitWorkflowMessage({
      type: KaiWorkflowMessageType.ModifiedFile,
      id: uuidv4(),
      data: modifiedFile,
    });
  }

  /**
   * Pre-read all unique files referenced by the incident list so we have
   * the original content available for diffing and revert when Goose
   * modifies them on disk.
   */
  private async cacheIncidentFileContents(input: KaiInteractiveWorkflowInput): Promise<void> {
    const uniquePaths = new Set<string>();
    for (const incident of input.incidents ?? []) {
      const absPath = this.uriToAbsolute(incident.uri);
      if (absPath) {
        uniquePaths.add(absPath);
      }
    }

    const results = await Promise.allSettled(
      Array.from(uniquePaths).map(async (absPath) => {
        const content = await fs.readFile(absPath, "utf-8");
        this.originalContentCache.set(absPath, content);
      }),
    );

    const cached = results.filter((r) => r.status === "fulfilled").length;
    this.logger.info("GooseWorkflow: pre-cached original file contents", {
      total: uniquePaths.size,
      cached,
      failed: uniquePaths.size - cached,
    });
  }

  /**
   * When a file-modifying tool starts, try to cache the target file's content
   * if we haven't already. This covers files Goose modifies that weren't in
   * the original incident list.
   */
  private tryCacheOriginalContent(toolName: string, args: Record<string, unknown>): void {
    const name = toolName?.toLowerCase() ?? "";
    const isFileModifying =
      name.includes("write") ||
      name.includes("save") ||
      name.includes("edit") ||
      name.includes("text_editor") ||
      name.includes("create") ||
      name.includes("replace") ||
      name.includes("patch");

    if (!isFileModifying) {
      return;
    }

    const filePath = (args.path ?? args.file_path ?? args.filename) as string | undefined;
    if (!filePath) {
      return;
    }

    const absPath = path.isAbsolute(filePath) ? filePath : path.join(this.workspaceDir, filePath);
    if (this.originalContentCache.has(absPath)) {
      return;
    }

    // Fire-and-forget async read. The tool_call notification arrives before
    // execution, so we usually win the race against the file write.
    fs.readFile(absPath, "utf-8")
      .then((content) => {
        if (!this.originalContentCache.has(absPath)) {
          this.originalContentCache.set(absPath, content);
          this.logger.debug("GooseWorkflow: cached original for non-incident file", {
            path: absPath,
          });
        }
      })
      .catch(() => {
        // File may not exist yet (new file) — that's fine
      });
  }

  private uriToAbsolute(uri: string): string | undefined {
    try {
      if (uri.startsWith("file://")) {
        return new URL(uri).pathname;
      }
      if (path.isAbsolute(uri)) {
        return uri;
      }
      return path.join(this.workspaceDir, uri);
    } catch {
      return undefined;
    }
  }
}
