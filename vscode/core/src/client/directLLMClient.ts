/**
 * DirectLLMClient: Non-agent backend that calls an LLM directly via
 * KaiInteractiveWorkflow (LangChain/LangGraph).
 *
 * Used when agentMode is disabled (focused fix mode). Translates
 * workflow events into the same event interface that AcpClient emits,
 * so the orchestrator can use a single code path.
 *
 * File changes are routed directly through routeFileChange (the
 * workflow produces in-memory content, not disk writes).
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
} from "@editor-extensions/agentic";
import { KaiWorkflowMessageType } from "@editor-extensions/agentic";
import type { AgentBackendClient, McpServerConfig, ToolCallData } from "./agentBackendClient";
import type { AgentState } from "@editor-extensions/shared";

// ─── Types ──────────────────────────────────────────────────────────

export interface DirectLLMClientConfig {
  workflow: KaiInteractiveWorkflow;
  workflowInput: KaiInteractiveWorkflowInput;
  logger: winston.Logger;
  routeFileChange: (path: string, content: string, originalContent?: string) => Promise<void>;
}

// ─── Client ─────────────────────────────────────────────────────────

export class DirectLLMClient extends EventEmitter implements AgentBackendClient {
  private readonly workflow: KaiInteractiveWorkflow;
  private readonly workflowInput: KaiInteractiveWorkflowInput;
  private readonly logger: winston.Logger;
  private readonly routeFileChangeFn: DirectLLMClientConfig["routeFileChange"];
  private promptActive = false;

  constructor(config: DirectLLMClientConfig) {
    super();
    this.workflow = config.workflow;
    this.workflowInput = config.workflowInput;
    this.logger = config.logger;
    this.routeFileChangeFn = config.routeFileChange;
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

  // ─── Core: run the workflow and translate events ─────────────────

  async sendMessage(_content: string, responseMessageId: string): Promise<string> {
    this.promptActive = true;

    this.logger.info("DirectLLMClient: running KaiInteractiveWorkflow", {
      incidentCount: this.workflowInput.incidents?.length ?? 0,
      migrationHint: this.workflowInput.migrationHint,
    });

    let active = true;
    this.workflow.on("workflowMessage", (msg: KaiWorkflowMessage) => {
      if (active) {
        this.translateWorkflowEvent(msg, responseMessageId);
      }
    });

    try {
      const result = await this.workflow.run(this.workflowInput);

      this.logger.info("DirectLLMClient: workflow complete", {
        modifiedFiles: result.modified_files?.length ?? 0,
        errors: result.errors?.length ?? 0,
      });

      this.emit("streamingComplete", responseMessageId, "end_turn");
      return "end_turn";
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error("DirectLLMClient: workflow error", { error: errorMessage });
      throw err;
    } finally {
      active = false;
      this.workflow.removeAllListeners();
      this.promptActive = false;
    }
  }

  // ─── Event translation ─────────────────────────────────────────────

  private translateWorkflowEvent(msg: KaiWorkflowMessage, responseMessageId: string): void {
    switch (msg.type) {
      case KaiWorkflowMessageType.LLMResponseChunk: {
        const chunk = msg.data as any;
        let text: string;
        if (typeof chunk.content === "string") {
          text = chunk.content;
        } else if (Array.isArray(chunk.content)) {
          text = chunk.content
            .filter((part: any) => part.type === "text" && typeof part.text === "string")
            .map((part: any) => part.text)
            .join("");
        } else {
          text = "";
        }
        if (text) {
          this.emit("streamingChunk", responseMessageId, text, "text");
        }
        break;
      }

      case KaiWorkflowMessageType.ToolCall: {
        const tc = msg.data as KaiToolCall;
        const toolData: ToolCallData = {
          name: tc.name || "Tool call",
          callId: tc.id,
          status: tc.status === "succeeded" || tc.status === "failed" ? tc.status : "running",
          result: tc.result,
        };

        if (tc.status === "generating" || tc.status === "running") {
          this.emit("toolCall", responseMessageId, toolData);
        } else {
          this.emit("toolCallUpdate", responseMessageId, toolData);
        }
        break;
      }

      case KaiWorkflowMessageType.ModifiedFile: {
        const fileData = msg.data as KaiModifiedFile;
        this.routeFileChangeFn(fileData.path, fileData.content, fileData.originalContent).catch(
          (err) => {
            this.logger.error("DirectLLMClient: failed to route file change", {
              path: fileData.path,
              error: err instanceof Error ? err.message : String(err),
            });
          },
        );
        break;
      }

      case KaiWorkflowMessageType.Error: {
        const errorText = msg.data as string;
        this.logger.error("DirectLLMClient: workflow error event", { error: errorText });
        // Emit as a text chunk so the error appears in chat
        this.emit("streamingChunk", responseMessageId, `Error: ${errorText}\n`, "text");
        break;
      }

      case KaiWorkflowMessageType.LLMResponse:
        // Final response — no action needed, streaming chunks already handled
        break;

      default:
        this.logger.debug("DirectLLMClient: unhandled workflow message type", {
          type: msg.type,
        });
        break;
    }
  }
}
