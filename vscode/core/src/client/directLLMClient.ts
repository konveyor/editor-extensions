/**
 * DirectLLMClient: Agent backend that delegates to KaiInteractiveWorkflow.
 *
 * Used when agentMode is disabled (focused fix mode). Wraps the existing
 * KaiInteractiveWorkflow from the agentic package behind the AgentClient
 * interface. The orchestrator wires workflow events through the
 * processMessage → MessageQueueManager pipeline for per-file accept/reject.
 *
 * The DirectLLMClient itself does not translate workflow events — it only
 * exposes the workflow and runs it. All message handling (LLM chunks,
 * modified files, user interactions) is done by the queue infrastructure.
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type winston from "winston";
import type {
  KaiInteractiveWorkflow,
  KaiInteractiveWorkflowInput,
} from "@editor-extensions/agentic";
import type { AgentClient, AgentState, McpServerConfig } from "./agentClient";

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

  getWorkflow(): KaiInteractiveWorkflow {
    return this.workflow;
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

  // ─── Core: run the workflow ────────────────────────────────────────

  async sendMessage(_content: string, _responseMessageId: string): Promise<string> {
    this.promptActive = true;

    this.logger.info("DirectLLMClient: running KaiInteractiveWorkflow", {
      incidentCount: this.workflowInput.incidents?.length ?? 0,
      migrationHint: this.workflowInput.migrationHint,
    });

    try {
      const result = await this.workflow.run(this.workflowInput);

      this.logger.info("DirectLLMClient: workflow complete", {
        modifiedFiles: result.modified_files?.length ?? 0,
        errors: result.errors?.length ?? 0,
      });

      return "end_turn";
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error("DirectLLMClient: workflow error", { error: errorMessage });
      throw err;
    } finally {
      this.promptActive = false;
    }
  }
}
