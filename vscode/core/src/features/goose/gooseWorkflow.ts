import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type winston from "winston";
import type {
  KaiWorkflow,
  KaiWorkflowInitOptions,
  KaiWorkflowResponse,
  KaiWorkflowMessage,
  KaiUserInteractionMessage,
} from "@editor-extensions/agentic";
import { KaiWorkflowMessageType } from "@editor-extensions/agentic";
import type { KaiInteractiveWorkflowInput } from "@editor-extensions/agentic";
import type { GooseClient, ToolCallData } from "../../client/gooseClient";
import type { GooseContentBlockType } from "@editor-extensions/shared";
import type { GooseFileTracker } from "./gooseFileTracker";
import { buildMigrationPrompt } from "./goosePromptBuilder";

/**
 * Adapter that implements KaiWorkflow by delegating to a GooseClient.
 *
 * Translates goose streaming events into KaiWorkflowMessage emissions
 * so the existing SolutionWorkflowOrchestrator and processMessage pipeline
 * can display streaming text, tool calls, and errors in the chat UI.
 *
 * File change detection:
 *  - MCP bridge apply_file_changes → gooseInit.ts onFileChanges (primary, fires during execution)
 *  - Post-scan via GooseFileTracker (fallback for Goose built-in tools)
 *    → emits ModifiedFile messages so the orchestrator queue processes them
 */
export class GooseWorkflow implements KaiWorkflow<KaiInteractiveWorkflowInput> {
  private readonly events = new EventEmitter();
  private workspaceDir = "";

  constructor(
    private readonly gooseClient: GooseClient,
    private readonly logger: winston.Logger,
    private readonly fileTracker?: GooseFileTracker,
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
    const errors: Error[] = [];

    // Pre-cache incident files so the post-scan can detect changes
    if (this.fileTracker) {
      this.fileTracker.clear();
      if (input.incidents?.length) {
        await this.fileTracker.cacheIncidentFiles(input.incidents, this.workspaceDir);
      }
    }

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

    const onToolCall = (_msgId: string, data: ToolCallData): void => {
      const callId = data.callId ?? uuidv4();

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
    };

    const onStreamingComplete = (_msgId: string, stopReason: string): void => {
      this.logger.info("GooseWorkflow: streaming complete", { messageId: _msgId, stopReason });
    };

    this.gooseClient.on("streamingChunk", onChunk);
    this.gooseClient.on("toolCall", onToolCall);
    this.gooseClient.on("toolCallUpdate", onToolCallUpdate);
    this.gooseClient.on("streamingComplete", onStreamingComplete);

    let missedChanges: import("./gooseFileTracker").TrackedFileChange[] = [];

    try {
      const stopReason = await this.gooseClient.sendMessage(prompt, acpRequestId);

      // Post-scan: find files changed by Goose's built-in tools that
      // bypassed the MCP bridge. Returned to the orchestrator which
      // routes them through routeFileChangeToBatchReview (same path
      // as MCP bridge files — single path to batch review).
      if (this.fileTracker) {
        missedChanges = await this.fileTracker.scanForMissedChanges();
      }

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

    return {
      modified_files: missedChanges.map((c) => ({
        path: c.path,
        content: c.content,
        originalContent: c.originalContent,
      })),
      errors,
    };
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
}
