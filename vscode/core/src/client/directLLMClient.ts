/**
 * DirectLLMClient: Agent backend that delegates to KaiInteractiveWorkflow.
 *
 * Used when agentMode is disabled (focused fix mode). Instead of calling
 * the LLM directly, it runs the existing KaiInteractiveWorkflow from the
 * agentic package and translates KaiWorkflowMessage events into AgentClient
 * events. This reuses BaseNode's battle-tested tool parsing logic, which
 * handles models without native tool support transparently.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type winston from "winston";
import type {
  KaiInteractiveWorkflow,
  KaiInteractiveWorkflowInput,
  KaiWorkflowMessage,
  KaiModifiedFile,
  KaiToolCall,
  KaiUserInteraction,
} from "@editor-extensions/agentic";
import { KaiWorkflowMessageType } from "@editor-extensions/agentic";
import type { AIMessageChunk, AIMessage } from "@langchain/core/messages";
import type { AgentClient, AgentState, McpServerConfig, ToolCallData } from "./agentClient";

// ─── Types ──────────────────────────────────────────────────────────

export interface DirectLLMClientConfig {
  workflow: KaiInteractiveWorkflow;
  workflowInput: KaiInteractiveWorkflowInput;
  logger: winston.Logger;
}

// ─── Client ─────────────────────────────────────────────────────────

export class DirectLLMClient extends EventEmitter implements AgentClient {
  private readonly workflow: KaiInteractiveWorkflow;
  private readonly workflowInput: KaiInteractiveWorkflowInput;
  private readonly logger: winston.Logger;
  private promptActive = false;

  constructor(config: DirectLLMClientConfig) {
    super();
    this.workflow = config.workflow;
    this.workflowInput = config.workflowInput;
    this.logger = config.logger;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.emit("stateChange", "running");
  }

  async stop(): Promise<void> {
    try {
      this.workflow.stop();
    } catch {
      // workflow may not be running
    }
    this.emit("stateChange", "stopped");
  }

  dispose(): void {
    try {
      this.workflow.stop();
    } catch {
      // workflow may not be running
    }
    this.workflow.removeAllListeners();
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
    try {
      this.workflow.stop();
    } catch {
      // workflow may not be running
    }
  }

  updateModelEnv(_env: Record<string, string>): void {}

  setMcpServers(_servers: McpServerConfig[]): void {}

  respondToRequest(_requestId: number, _result: unknown): void {}

  // ─── Core: run workflow and translate events ───────────────────────

  async sendMessage(_content: string, responseMessageId: string): Promise<string> {
    this.promptActive = true;

    const messageId = responseMessageId;

    this.logger.info("DirectLLMClient: running KaiInteractiveWorkflow", {
      incidentCount: this.workflowInput.incidents?.length ?? 0,
      migrationHint: this.workflowInput.migrationHint,
    });

    const onMessage = (msg: KaiWorkflowMessage) => {
      this.translateWorkflowMessage(msg, messageId);
    };

    this.workflow.on("workflowMessage", onMessage);

    try {
      const result = await this.workflow.run(this.workflowInput);

      this.logger.info("DirectLLMClient: workflow complete", {
        modifiedFiles: result.modified_files?.length ?? 0,
        errors: result.errors?.length ?? 0,
      });

      this.emit("streamingComplete", messageId, "end_turn");
      return "end_turn";
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error("DirectLLMClient: workflow error", { error: errorMessage });
      this.emit("error", err instanceof Error ? err : new Error(errorMessage));
      throw err;
    } finally {
      this.workflow.removeAllListeners();
      this.promptActive = false;
    }
  }

  // ─── Event translation ─────────────────────────────────────────────

  private translateWorkflowMessage(msg: KaiWorkflowMessage, messageId: string): void {
    switch (msg.type) {
      case KaiWorkflowMessageType.LLMResponseChunk: {
        const chunk = msg.data as AIMessageChunk;
        const text = this.extractText(chunk);
        if (text) {
          this.emit("streamingChunk", messageId, text, "text");
        }
        break;
      }

      case KaiWorkflowMessageType.LLMResponse: {
        const response = msg.data as AIMessage;
        const text = this.extractText(response);
        if (text) {
          this.emit("streamingChunk", messageId, text, "text");
        }
        break;
      }

      case KaiWorkflowMessageType.ModifiedFile: {
        const file = msg.data as KaiModifiedFile;
        this.emitFileChange(messageId, file);
        break;
      }

      case KaiWorkflowMessageType.ToolCall: {
        const toolCall = msg.data as KaiToolCall;
        this.emitToolCall(messageId, toolCall);
        break;
      }

      case KaiWorkflowMessageType.UserInteraction: {
        const interaction = msg.data as KaiUserInteraction;
        this.autoResolveInteraction(msg.id, interaction);
        break;
      }

      case KaiWorkflowMessageType.Error: {
        const errorText = msg.data as string;
        this.logger.error("DirectLLMClient: workflow reported error", { error: errorText });
        break;
      }
    }
  }

  private extractText(message: AIMessageChunk | AIMessage): string {
    if (typeof message.content === "string") {
      return message.content;
    }
    if (Array.isArray(message.content)) {
      return (message.content as Array<{ type: string; text?: string }>)
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("");
    }
    return "";
  }

  // ─── File change → AgentClient events ──────────────────────────────

  private emitFileChange(messageId: string, file: KaiModifiedFile): void {
    const callId = `workflow-${uuidv4()}`;

    const toolCallData: ToolCallData = {
      name: "write_file",
      callId,
      arguments: { path: file.path, content: file.content },
      status: "running",
    };

    this.emit("toolCall", messageId, toolCallData);

    this.emit("toolCallUpdate", messageId, {
      ...toolCallData,
      status: "succeeded",
      result: `Updated ${file.path}`,
    });
  }

  // ─── Tool call → AgentClient events ────────────────────────────────

  private emitToolCall(messageId: string, toolCall: KaiToolCall): void {
    const status =
      toolCall.status === "generating" || toolCall.status === "running"
        ? "running"
        : toolCall.status;

    this.emit("toolCall", messageId, {
      name: toolCall.name ?? "tool",
      callId: toolCall.id,
      status,
      result: toolCall.result,
    } as ToolCallData);
  }

  // ─── Auto-resolve user interactions in focused-fix mode ────────────

  private autoResolveInteraction(msgId: string, interaction: KaiUserInteraction): void {
    if (interaction.type === "yesNo") {
      this.logger.info("DirectLLMClient: auto-accepting yes/no interaction");
      this.workflow.resolveUserInteraction({
        type: KaiWorkflowMessageType.UserInteraction,
        id: msgId,
        data: {
          ...interaction,
          response: { yesNo: true },
        },
      });
    } else {
      this.logger.warn("DirectLLMClient: unhandled user interaction type", {
        type: interaction.type,
      });
    }
  }
}
