import { EventEmitter } from "events";
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
    const errors: Error[] = [];

    const prompt = await buildMigrationPrompt(input, this.workspaceDir);
    const messageId = uuidv4();

    const onChunk = (_msgId: string, content: string, contentType: GooseContentBlockType): void => {
      if (contentType !== "text" || !content) {
        return;
      }
      this.emitWorkflowMessage({
        type: KaiWorkflowMessageType.LLMResponseChunk,
        id: messageId,
        data: { content } as any,
      });
    };

    const onToolCall = (_msgId: string, data: ToolCallData): void => {
      this.emitWorkflowMessage({
        type: KaiWorkflowMessageType.ToolCall,
        id: data.callId ?? uuidv4(),
        data: {
          id: data.callId ?? uuidv4(),
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
    };

    const onToolCallUpdate = (_msgId: string, data: ToolCallData): void => {
      this.emitWorkflowMessage({
        type: KaiWorkflowMessageType.ToolCall,
        id: data.callId ?? uuidv4(),
        data: {
          id: data.callId ?? uuidv4(),
          name: data.name,
          status:
            data.status === "succeeded"
              ? "succeeded"
              : data.status === "failed"
                ? "failed"
                : "running",
        },
      });

      if (data.status === "succeeded" && data.result) {
        this.tryExtractModifiedFile(data);
      }
    };

    this.gooseClient.on("streamingChunk", onChunk);
    this.gooseClient.on("toolCall", onToolCall);
    this.gooseClient.on("toolCallUpdate", onToolCallUpdate);

    try {
      const stopReason = await this.gooseClient.sendMessage(prompt, messageId);

      this.emitWorkflowMessage({
        type: KaiWorkflowMessageType.LLMResponse,
        id: messageId,
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
   * Heuristic: if a tool named write_file / writeFile / similar succeeded,
   * try to extract the file path and content from its result or arguments
   * and emit a ModifiedFile message.
   */
  private tryExtractModifiedFile(data: ToolCallData): void {
    const name = data.name?.toLowerCase() ?? "";
    if (!name.includes("write") && !name.includes("save") && !name.includes("edit")) {
      return;
    }

    const args = data.arguments ?? {};
    const filePath = (args.path ?? args.file_path ?? args.filename) as string | undefined;
    const content = (args.content ?? args.text ?? data.result) as string | undefined;

    if (!filePath || !content) {
      return;
    }

    const modifiedFile: KaiModifiedFile = { path: filePath, content };
    this.modifiedFiles.push(modifiedFile);

    this.emitWorkflowMessage({
      type: KaiWorkflowMessageType.ModifiedFile,
      id: uuidv4(),
      data: modifiedFile,
    });
  }
}
