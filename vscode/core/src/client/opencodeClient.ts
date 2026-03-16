/**
 * OpencodeAgentClient: Agent backend using the @opencode-ai/sdk.
 *
 * Spawns an embedded OpenCode server via `createOpencode()`, subscribes
 * to SSE events, and maps them to the shared AgentClient event contract
 * so the rest of the extension (orchestrator, handlers, init) can treat
 * it identically to GooseClient.
 */

import { EventEmitter } from "events";
import type winston from "winston";
import type {
  AgentClient,
  AgentState,
  McpServerConfig,
  ToolCallData,
  PermissionRequestData,
} from "./agentClient";

// ─── Config ──────────────────────────────────────────────────────────

export interface OpencodeClientConfig {
  workspaceDir: string;
  logger: winston.Logger;
  opencodeBinaryPath?: string | null;
  mcpServers?: McpServerConfig[];
  modelEnv?: Record<string, string>;
}

// ─── OpencodeAgentClient ─────────────────────────────────────────────

export class OpencodeAgentClient extends EventEmitter implements AgentClient {
  private agentState: AgentState = "stopped";
  private sessionId: string | null = null;
  private server: { url: string; close(): void } | null = null;
  private client: any | null = null;
  private eventAbortController: AbortController | null = null;
  private promptActive = false;
  private disposed = false;

  private readonly config: OpencodeClientConfig;
  private readonly logger: winston.Logger;

  constructor(config: OpencodeClientConfig) {
    super();
    if (config.workspaceDir.startsWith("file://")) {
      config = { ...config, workspaceDir: new URL(config.workspaceDir).pathname };
    }
    this.config = config;
    this.logger = config.logger;
  }

  // ─── Public API ───────────────────────────────────────────────────

  getState(): AgentState {
    return this.agentState;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  isPromptActive(): boolean {
    return this.promptActive;
  }

  updateModelEnv(env: Record<string, string>): void {
    (this.config as OpencodeClientConfig).modelEnv = {
      ...this.config.modelEnv,
      ...env,
    };
  }

  setMcpServers(servers: McpServerConfig[]): void {
    (this.config as OpencodeClientConfig).mcpServers = servers;
  }

  respondToRequest(requestId: number, result: unknown): void {
    // OpenCode permission responses go through the SDK's API
    // The permission handler resolves these via client.session.command or similar
    this.logger.info("OpencodeAgentClient: respondToRequest", { requestId, result });
  }

  async start(): Promise<void> {
    if (this.agentState === "running" || this.agentState === "starting") {
      this.logger.warn("OpencodeAgentClient: already running or starting");
      return;
    }

    this.setState("starting");

    try {
      const { createOpencode } = await import("@opencode-ai/sdk");

      // Build MCP config from the shared McpServerConfig format
      const mcpConfig: Record<string, any> = {};
      for (const server of this.config.mcpServers ?? []) {
        const envMap: Record<string, string> = {};
        for (const e of server.env ?? []) {
          envMap[e.name] = e.value;
        }
        mcpConfig[server.name] = {
          type: "local",
          command: [server.command, ...server.args],
          env: Object.keys(envMap).length > 0 ? envMap : undefined,
        };
      }

      // Build provider config from model env vars
      const providerConfig: Record<string, any> = {};
      if (this.config.modelEnv) {
        // Pass common API keys to provider options
        if (this.config.modelEnv.ANTHROPIC_API_KEY) {
          providerConfig.anthropic = {
            options: { apiKey: this.config.modelEnv.ANTHROPIC_API_KEY },
          };
        }
        if (this.config.modelEnv.OPENAI_API_KEY) {
          providerConfig.openai = {
            options: { apiKey: this.config.modelEnv.OPENAI_API_KEY },
          };
        }
      }

      // Inject model env into the process environment for the server
      if (this.config.modelEnv) {
        Object.assign(process.env, this.config.modelEnv);
      }

      const config: Record<string, any> = {};
      if (Object.keys(mcpConfig).length > 0) {
        config.mcp = mcpConfig;
      }
      if (Object.keys(providerConfig).length > 0) {
        config.provider = providerConfig;
      }

      const opencode = await createOpencode({
        config: Object.keys(config).length > 0 ? config : undefined,
        timeout: 30_000,
      });

      this.client = opencode.client;
      this.server = opencode.server;

      this.logger.info(`OpencodeAgentClient: server running at ${this.server?.url}`);

      // Create initial session
      const session = await this.client.session.create({
        body: { title: "Konveyor Migration Assistant" },
      });
      this.sessionId = session.data.id;
      this.logger.info(`OpencodeAgentClient: session created ${this.sessionId}`);

      // Start event subscription
      this.subscribeToEvents();

      this.setState("running");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`OpencodeAgentClient: start failed: ${error.message}`);
      this.setState("error");
      this.emit("error", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.logger.info("OpencodeAgentClient: stopping...");

    // Abort event subscription
    if (this.eventAbortController) {
      this.eventAbortController.abort();
      this.eventAbortController = null;
    }

    // Close server
    if (this.server) {
      try {
        this.server.close();
      } catch {
        // Server may have already exited
      }
      this.server = null;
    }

    this.client = null;
    this.sessionId = null;
    this.promptActive = false;
    this.setState("stopped");
    this.logger.info("OpencodeAgentClient: stopped");
  }

  dispose(): void {
    this.disposed = true;
    this.stop().catch(() => {});
    this.removeAllListeners();
  }

  async sendMessage(content: string, responseMessageId: string): Promise<string> {
    if (this.agentState !== "running" || !this.sessionId || !this.client) {
      throw new Error("OpencodeAgentClient: not running");
    }

    this.promptActive = true;

    try {
      const result = await this.client.session.prompt({
        path: { id: this.sessionId },
        body: {
          parts: [{ type: "text", text: content }],
        },
      });

      const stopReason = result.data?.info?.stopReason ?? "end_turn";

      this.emit("streamingComplete", responseMessageId, stopReason);
      this.promptActive = false;
      return stopReason;
    } catch (err) {
      this.promptActive = false;
      throw err;
    }
  }

  async createSession(): Promise<string> {
    if (this.agentState !== "running" || !this.client) {
      throw new Error("OpencodeAgentClient: not running");
    }

    const session = await this.client.session.create({
      body: { title: "Konveyor Migration Assistant" },
    });

    this.sessionId = session.data.id;
    this.logger.info(`OpencodeAgentClient: new session created ${this.sessionId}`);
    return this.sessionId!;
  }

  cancelGeneration(): void {
    if (!this.sessionId || !this.client) {
      return;
    }

    this.client.session.abort({ path: { id: this.sessionId } }).catch((err: Error) => {
      this.logger.warn(`OpencodeAgentClient: cancel failed: ${err.message}`);
    });
  }

  // ─── Event subscription ────────────────────────────────────────────

  private async subscribeToEvents(): Promise<void> {
    if (!this.client || this.disposed) {
      return;
    }

    this.eventAbortController = new AbortController();

    try {
      const events = await this.client.event.subscribe();

      // Process events in background
      void (async () => {
        try {
          for await (const event of events.stream) {
            if (this.disposed || this.eventAbortController?.signal.aborted) {
              break;
            }
            this.handleEvent(event);
          }
        } catch (err) {
          if (!this.disposed) {
            this.logger.warn(`OpencodeAgentClient: event stream error: ${err}`);
          }
        }
      })();
    } catch (err) {
      this.logger.error(`OpencodeAgentClient: failed to subscribe to events: ${err}`);
    }
  }

  private handleEvent(event: { type: string; properties: any }): void {
    const { type, properties } = event;

    switch (type) {
      case "message.part.delta": {
        // Incremental text update
        const { sessionID, messageID, partID, field, delta } = properties;
        if (sessionID === this.sessionId && field === "content" && delta) {
          this.emit("streamingChunk", messageID, delta, "text");
        }
        break;
      }

      case "message.part.updated": {
        // Full part update — handle tool calls and other content types
        const part = properties;
        if (part.sessionID !== this.sessionId) {
          break;
        }

        if (part.type === "tool-invocation" || part.type === "tool_call") {
          const toolData: ToolCallData = {
            name: part.toolName ?? part.name ?? "Tool call",
            callId: part.partID ?? part.id,
            arguments: part.input ?? part.arguments,
            status: this.mapToolStatus(part.state ?? part.status),
            result: part.output ?? part.result,
          };

          if (toolData.status === "running") {
            this.emit("toolCall", part.messageID, toolData);
          } else {
            this.emit("toolCallUpdate", part.messageID, toolData);
          }
        }
        break;
      }

      case "permission.asked": {
        const data: PermissionRequestData = {
          requestId: properties.id ?? 0,
          toolCallId: properties.toolCallId ?? "",
          title: properties.title ?? properties.message ?? "Permission requested",
          kind: properties.kind ?? "other",
          status: "pending",
          rawInput: properties.input,
          options: (properties.options ?? []).map((opt: any) => ({
            optionId: opt.id ?? opt.optionId,
            name: opt.label ?? opt.name,
            kind: opt.kind ?? "allow_once",
          })),
        };
        this.emit("permissionRequest", data);
        break;
      }

      case "session.updated": {
        // Could be used for state tracking
        this.logger.debug("OpencodeAgentClient: session updated", { properties });
        break;
      }

      default:
        // Ignore other events (server.connected, heartbeat, etc.)
        break;
    }
  }

  private mapToolStatus(state: string): "running" | "succeeded" | "failed" {
    switch (state) {
      case "completed":
      case "succeeded":
      case "result":
        return "succeeded";
      case "failed":
      case "error":
        return "failed";
      default:
        return "running";
    }
  }

  // ─── State management ──────────────────────────────────────────────

  private setState(newState: AgentState): void {
    if (this.agentState !== newState) {
      this.agentState = newState;
      this.emit("stateChange", newState);
    }
  }
}
