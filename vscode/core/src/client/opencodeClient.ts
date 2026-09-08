/**
 * OpencodeAgentClient: Agent backend using the @opencode-ai/sdk.
 *
 * Spawns an embedded OpenCode server via `createOpencode()`, subscribes
 * to SSE events, and maps them to the shared AgentClient event contract
 * so the rest of the extension (orchestrator, handlers, init) can treat
 * it identically to GooseClient.
 */

import { EventEmitter } from "events";
import { execFile } from "child_process";
import { randomBytes } from "crypto";
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
  /** OpenCode model identifier, e.g. "anthropic/claude-sonnet-4" or "google/gemini-2.0-flash" */
  opencodeModel?: string;
}

const DEFAULT_OPENCODE_PORT = 4096;

/**
 * Kill any process listening on the given port. Handles orphaned servers
 * left behind by a previous extension host that didn't shut down cleanly.
 */
async function killProcessOnPort(port: number, logger: winston.Logger): Promise<void> {
  const cmd = process.platform === "win32" ? "netstat" : "lsof";
  const args = process.platform === "win32" ? ["-ano", "-p", "TCP"] : ["-ti", `tcp:${port}`];

  return new Promise<void>((resolve) => {
    execFile(cmd, args, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve();
        return;
      }

      if (process.platform === "win32") {
        const pids = new Set<string>();
        for (const line of stdout.split("\n")) {
          if (line.includes(`:${port}`) && line.includes("LISTENING")) {
            const pid = line.trim().split(/\s+/).pop();
            if (pid && pid !== "0") {
              pids.add(pid);
            }
          }
        }
        for (const pid of pids) {
          try {
            process.kill(Number(pid), "SIGTERM");
            logger.info(`OpencodeAgentClient: killed orphaned process ${pid} on port ${port}`);
          } catch {
            // Process may have already exited
          }
        }
        resolve();
      } else {
        // lsof -ti returns PIDs, one per line
        const pids = stdout.trim().split("\n").filter(Boolean);
        for (const pid of pids) {
          try {
            process.kill(Number(pid), "SIGTERM");
            logger.info(`OpencodeAgentClient: killed orphaned process ${pid} on port ${port}`);
          } catch {
            // Process may have already exited
          }
        }
        resolve();
      }
    });
  });
}

// ─── OpencodeAgentClient ─────────────────────────────────────────────

export class OpencodeAgentClient extends EventEmitter implements AgentClient {
  private agentState: AgentState = "stopped";
  private sessionId: string | null = null;
  private server: { url: string; close(): void } | null = null;
  private serverAbortController: AbortController | null = null;
  private client: any | null = null;
  private eventAbortController: AbortController | null = null;
  private promptActive = false;
  private activeResponseMessageId: string | null = null;
  private disposed = false;
  private injectedEnvKeys: string[] = [];

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
    if (!this.client || !this.sessionId) {
      this.logger.warn("OpencodeAgentClient: cannot respond — no active session");
      return;
    }

    // Map the extension's outcome format to OpenCode's permission response
    const outcome = (result as any)?.outcome;
    let response: "once" | "always" | "reject" = "reject";
    if (outcome?.outcome === "selected") {
      // Determine response from the optionId kind
      const optionId = outcome.optionId as string;
      if (optionId.includes("allow_once") || optionId.includes("allow")) {
        response = "once";
      } else if (optionId.includes("always")) {
        response = "always";
      }
    }

    const permissionId = String(requestId);
    this.client
      .postSessionIdPermissionsPermissionId?.({
        path: { id: this.sessionId, permissionID: permissionId },
        body: { response },
      })
      .catch((err: Error) => {
        this.logger.warn(`OpencodeAgentClient: permission response failed: ${err.message}`);
      });
  }

  async start(): Promise<void> {
    if (this.agentState === "running" || this.agentState === "starting") {
      this.logger.warn("OpencodeAgentClient: already running or starting");
      return;
    }

    this.setState("starting");

    try {
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
          environment: Object.keys(envMap).length > 0 ? envMap : undefined,
        };
      }

      // Build provider config from model env vars
      const providerConfig: Record<string, any> = {};
      if (this.config.modelEnv) {
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
        if (this.config.modelEnv.GOOGLE_API_KEY) {
          providerConfig.google = {
            options: { apiKey: this.config.modelEnv.GOOGLE_API_KEY },
          };
        }
      }

      // Generate a random password so the local server rejects unauthorized callers.
      // The SDK's createOpencodeServer spreads process.env into the child, so
      // setting it here makes it available to the server as OPENCODE_SERVER_PASSWORD.
      const serverPassword = randomBytes(32).toString("hex");
      process.env.OPENCODE_SERVER_PASSWORD = serverPassword;
      this.injectedEnvKeys.push("OPENCODE_SERVER_PASSWORD");

      // Inject model env into the process environment for the server
      if (this.config.modelEnv) {
        for (const key of Object.keys(this.config.modelEnv)) {
          process.env[key] = this.config.modelEnv[key];
          this.injectedEnvKeys.push(key);
        }
      }

      const config: Record<string, any> = {};
      if (this.config.opencodeModel) {
        config.model = this.config.opencodeModel;
      }
      if (Object.keys(mcpConfig).length > 0) {
        config.mcp = mcpConfig;
      }
      if (Object.keys(providerConfig).length > 0) {
        config.provider = providerConfig;
      }

      // Log the config (redact API keys) so we can diagnose server-side errors.
      const redactedConfig = JSON.parse(JSON.stringify(config));
      if (redactedConfig.provider) {
        for (const p of Object.values(redactedConfig.provider) as any[]) {
          if (p?.options?.apiKey) {
            p.options.apiKey = `${p.options.apiKey.slice(0, 4)}…`;
          }
        }
      }
      this.logger.info(
        `OpencodeAgentClient: OPENCODE_CONFIG_CONTENT = ${JSON.stringify(redactedConfig)}`,
      );

      const { createOpencodeServer } = await import("@opencode-ai/sdk");
      const { createOpencodeClient } = await import("@opencode-ai/sdk");

      // Kill any orphaned server left by a previous extension host
      await killProcessOnPort(DEFAULT_OPENCODE_PORT, this.logger);

      this.serverAbortController = new AbortController();
      const server = await createOpencodeServer({
        config: Object.keys(config).length > 0 ? config : undefined,
        timeout: 30_000,
        signal: this.serverAbortController.signal,
      });

      // VS Code's Node.js fetch doesn't accept a Request object as the
      // first argument (throws "Failed to parse URL from [object Request]").
      // Provide a wrapper that extracts the URL string from the Request
      // and injects HTTP Basic auth (OpenCode uses Basic, not Bearer).
      const basicAuth = Buffer.from(`opencode:${serverPassword}`).toString("base64");
      const nodeSafeFetch = (request: Request) => {
        const headers = new Headers(request.headers);
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Basic ${basicAuth}`);
        }
        return fetch(request.url, {
          method: request.method,
          headers,
          body: request.body,
          redirect: request.redirect,
          signal: request.signal,
          duplex: request.body ? "half" : undefined,
        });
      };

      const client = createOpencodeClient({
        baseUrl: server.url,
        fetch: nodeSafeFetch,
        headers: { Authorization: `Basic ${basicAuth}` },
      });

      this.client = client;
      this.server = server;

      this.logger.info(`OpencodeAgentClient: server running at ${this.server?.url}`);

      // Create initial session
      const session = await this.client.session.create({
        body: { title: "Konveyor Migration Assistant" },
      });

      this.logger.info(
        `OpencodeAgentClient: session.create response: ${JSON.stringify(session, null, 2)}`,
      );

      if (session.error) {
        throw new Error(
          `Session creation failed: ${typeof session.error === "string" ? session.error : JSON.stringify(session.error)}`,
        );
      }

      const sessionData = session.data ?? session.response?.body;
      const sessionId = sessionData?.id ?? sessionData?.ID;
      if (!sessionId) {
        throw new Error(
          `Session response missing id. Keys: ${JSON.stringify(Object.keys(session))}`,
        );
      }
      this.sessionId = sessionId;
      this.logger.info(`OpencodeAgentClient: session created ${this.sessionId}`);

      // Start event subscription
      this.subscribeToEvents();

      this.setState("running");
    } catch (err) {
      if (this.serverAbortController) {
        this.serverAbortController.abort();
        this.serverAbortController = null;
      }
      if (this.server) {
        try {
          this.server.close();
        } catch {
          // Server may have already exited
        }
        this.server = null;
      }
      this.client = null;
      for (const key of this.injectedEnvKeys) {
        delete process.env[key];
      }
      this.injectedEnvKeys = [];

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

    // Signal the server to shut down, then call close() as a fallback
    if (this.serverAbortController) {
      this.serverAbortController.abort();
      this.serverAbortController = null;
    }
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
    for (const key of this.injectedEnvKeys) {
      delete process.env[key];
    }
    this.injectedEnvKeys = [];
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
    this.activeResponseMessageId = responseMessageId;

    try {
      // promptAsync returns 204 immediately — actual results stream back
      // via SSE events. We must wait for the prompt to finish so callers
      // (e.g. AgentOrchestrator) don't tear down listeners prematurely.
      const completionPromise = new Promise<string>((resolve, reject) => {
        const onComplete = (_msgId: string, stopReason: string) => {
          cleanup();
          resolve(stopReason);
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          this.removeListener("streamingComplete", onComplete);
          this.removeListener("error", onError);
        };
        this.once("streamingComplete", onComplete);
        this.once("error", onError);
      });

      await this.client.session.promptAsync({
        path: { id: this.sessionId },
        body: {
          parts: [{ type: "text", text: content }],
        },
      });

      return await completionPromise;
    } catch (err) {
      this.promptActive = false;
      this.activeResponseMessageId = null;
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

      this.logger.info("OpencodeAgentClient: SSE event stream connected");

      // Process events in background
      void (async () => {
        let eventCount = 0;
        try {
          for await (const event of events.stream) {
            if (this.disposed || this.eventAbortController?.signal.aborted) {
              break;
            }
            eventCount++;
            const evtType = event.type ?? event.event ?? "unknown";
            if (eventCount <= 20 || eventCount % 50 === 0) {
              this.logger.info(
                `OpencodeAgentClient: SSE event #${eventCount} type=${evtType}` +
                  (evtType === "message.part.delta"
                    ? ` field=${event.properties?.field ?? event.data?.field ?? "?"} delta=${(event.properties?.delta ?? event.data?.delta ?? "").slice(0, 40)}`
                    : ""),
              );
            }
            this.handleEvent(event);
          }
          this.logger.info(`OpencodeAgentClient: event stream ended after ${eventCount} events`);
        } catch (err) {
          if (!this.disposed) {
            this.logger.warn(
              `OpencodeAgentClient: event stream error after ${eventCount} events: ${err}`,
            );
          }
        }
      })();
    } catch (err) {
      this.logger.error(`OpencodeAgentClient: failed to subscribe to events: ${err}`);
    }
  }

  private handleEvent(event: any): void {
    const type = event.type ?? event.event;
    const properties = event.properties ?? event.data ?? event;

    if (!type) {
      this.logger.debug(
        `OpencodeAgentClient: event missing type, keys=${JSON.stringify(Object.keys(event))}`,
      );
      return;
    }

    switch (type) {
      case "message.part.delta": {
        const { sessionID, delta, field } = properties;
        if (sessionID !== this.sessionId || !delta) {
          break;
        }

        const msgId = this.activeResponseMessageId ?? properties.messageID;

        // OpenCode's delta fields: "text" = main visible response,
        // "content" = extended thinking / reasoning
        if (field === "text") {
          this.emit("streamingChunk", msgId, delta, "text");
        } else if (field === "content") {
          this.emit("streamingChunk", msgId, delta, "thinking");
        }
        break;
      }

      case "message.part.updated": {
        const part = properties?.part ?? properties;
        const partSessionID = part.sessionID ?? part.sessionId;
        if (partSessionID !== this.sessionId) {
          break;
        }

        if (part.type === "tool" || part.type === "tool-invocation" || part.type === "tool_call") {
          this.handleToolPartUpdate(part);
        } else if (part.type === "reasoning" && part.text) {
          this.emit("streamingChunk", part.messageID, part.text, "thinking");
        }
        break;
      }

      case "permission.asked":
      case "permission.updated": {
        const data: PermissionRequestData = {
          requestId: properties.id ?? 0,
          toolCallId: properties.toolCallId ?? properties.callID ?? "",
          title: properties.title ?? properties.message ?? "Permission requested",
          toolName: properties.type ?? undefined,
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
        this.logger.debug("OpencodeAgentClient: session updated", { properties });
        break;
      }

      case "session.completed":
      case "session.idle":
      case "session.status": {
        const status = properties?.status ?? properties?.state ?? type.split(".")[1];
        if (
          (status === "completed" || status === "idle" || type === "session.completed") &&
          this.promptActive
        ) {
          this.promptActive = false;
          const msgId = this.activeResponseMessageId ?? "";
          this.activeResponseMessageId = null;
          this.logger.info(
            `OpencodeAgentClient: prompt finished (event=${type}, status=${status})`,
          );
          this.emit("streamingComplete", msgId, "end_turn");
        }
        break;
      }

      case "session.error": {
        const err = properties?.error ?? properties;
        const errorName = err?.name ?? "UnknownError";
        const errorData = err?.data ?? {};
        const errorMsg = err?.message ?? errorName;

        const detail = errorData.providerID
          ? `${errorMsg} (provider=${errorData.providerID}, model=${errorData.modelID}` +
            `${errorData.suggestions?.length ? `, try: ${errorData.suggestions.join(", ")}` : ""})`
          : errorMsg;

        this.logger.error(`OpencodeAgentClient: session error: ${detail}`);

        if (this.promptActive) {
          this.promptActive = false;
          const msgId = this.activeResponseMessageId ?? "";
          this.activeResponseMessageId = null;
          this.emit("streamingChunk", msgId, `\n\n**Error:** ${detail}`, "text");
          this.emit("streamingComplete", msgId, "error");
        }
        break;
      }

      default:
        if (type.includes("error") || type.includes("fail")) {
          this.logger.warn(
            `OpencodeAgentClient: unhandled error event: ${type} ${JSON.stringify(properties)}`,
          );
        }
        break;
    }
  }

  private handleToolPartUpdate(part: any): void {
    // OpenCode SDK uses ToolPart: { type: "tool", callID, tool, state: ToolState }
    const state = part.state ?? {};
    const toolData: ToolCallData = {
      name: state.title ?? part.tool ?? part.toolName ?? part.name ?? "Tool call",
      callId: part.callID ?? part.partID ?? part.id,
      arguments: state.input ?? part.input ?? part.arguments,
      status: this.mapToolStatus(state.status ?? part.status ?? "running"),
      result: state.output ?? state.error ?? part.output ?? part.result,
    };

    if (toolData.status === "running") {
      this.emit("toolCall", part.messageID, toolData);
    } else {
      this.emit("toolCallUpdate", part.messageID, toolData);
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
