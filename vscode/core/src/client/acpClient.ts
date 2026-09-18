/**
 * AcpClient: Unified ACP (Agent Client Protocol) client for communicating
 * with any ACP-compliant AI agent (Goose, OpenCode, etc.) via subprocess.
 *
 * Uses @agentclientprotocol/sdk's ClientSideConnection over stdio.
 * Spawns `<binary> acp` as a child process and communicates via JSON-RPC 2.0
 * over newline-delimited JSON.
 *
 * @see https://agentclientprotocol.com
 */

import { ChildProcess, spawn, execFile } from "child_process";
import { Readable, Writable } from "stream";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import winston from "winston";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type {
  Client,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  ReadTextFileRequest,
  ReadTextFileResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  McpServer,
  ContentBlock,
  SessionUpdate,
  ToolCallContent,
} from "@agentclientprotocol/sdk";
import type { AgentState } from "@editor-extensions/shared";
import type {
  AgentBackendClient,
  McpServerConfig,
  PermissionRequestData,
  PermissionOption,
  ToolCallData,
} from "./agentBackendClient";

// Re-export shared types for consumers
export type {
  ToolCallData,
  PermissionOption,
  PermissionRequestData,
  StreamingResourceData,
  McpServerConfig,
  AgentBackendClient,
} from "./agentBackendClient";

// ─── Config ──────────────────────────────────────────────────────────

export interface AcpClientConfig {
  workspaceDir: string;
  logger: winston.Logger;
  binaryName: string;
  binaryArgs: string[];
  minimumVersion: string;
  binaryPath?: string | null;
  mcpServers?: McpServerConfig[];
  modelEnv?: Record<string, string>;
}

// ─── Constants ────────────────────────────────────────────────────────

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;

// ─── AcpClient ───────────────────────────────────────────────────────

export class AcpClient extends EventEmitter implements AgentBackendClient {
  private process: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private state: AgentState = "stopped";
  private sessionId: string | null = null;
  private binaryPath: string | null = null;
  private disposed = false;

  // Track permission request IDs for respondToRequest
  private nextPermissionId = 1;
  private pendingPermissionResolvers = new Map<
    number,
    (response: RequestPermissionResponse) => void
  >();

  // Current streaming state
  private currentResponseId: string | null = null;

  private readonly config: AcpClientConfig;
  private readonly logger: winston.Logger;

  constructor(config: AcpClientConfig) {
    super();
    if (config.workspaceDir.startsWith("file://")) {
      config = { ...config, workspaceDir: new URL(config.workspaceDir).pathname };
    }
    this.config = config;
    this.logger = config.logger;
  }

  // ─── Public API ───────────────────────────────────────────────────

  getState(): AgentState {
    return this.state;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  isPromptActive(): boolean {
    return this.currentResponseId !== null;
  }

  updateModelEnv(env: Record<string, string>): void {
    (this.config as AcpClientConfig).modelEnv = {
      ...this.config.modelEnv,
      ...env,
    };
  }

  setMcpServers(servers: McpServerConfig[]): void {
    (this.config as AcpClientConfig).mcpServers = servers;
  }

  /**
   * Start the agent: discover binary, check version, spawn process,
   * initialize ACP, and create a session.
   */
  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") {
      this.logger.warn("AcpClient: already running or starting");
      return;
    }

    this.setState("starting");

    try {
      this.binaryPath = await this.discoverBinary();
      this.logger.info(`AcpClient: found binary at ${this.binaryPath}`);

      await this.checkVersion(this.binaryPath);

      this.spawnAndConnect(this.binaryPath);

      const initResponse = await this.connection!.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
        },
      });

      this.logger.info(`AcpClient: initialized, protocol v${initResponse.protocolVersion}`);
      if (initResponse.agentInfo) {
        this.logger.info(
          `AcpClient: agent ${initResponse.agentInfo.name} v${initResponse.agentInfo.version}`,
        );
      }

      // Convert McpServerConfig to ACP McpServer format
      const mcpServers: McpServer[] = (this.config.mcpServers ?? []).map((s) => ({
        type: "stdio" as const,
        name: s.name,
        command: s.command,
        args: s.args,
        env: (s.env ?? []).map((e) => ({ name: e.name, value: e.value })),
      }));

      const sessionResponse = await this.connection!.newSession({
        cwd: this.config.workspaceDir,
        mcpServers,
      });

      this.sessionId = sessionResponse.sessionId;
      this.logger.info(`AcpClient: session created ${this.sessionId}`);

      this.setState("running");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`AcpClient: start failed: ${error.message}`);
      this.setState("error");
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Send a user message and stream the response.
   * Returns the stop reason when generation completes.
   */
  async sendMessage(content: string, responseMessageId: string): Promise<string> {
    if (this.state !== "running" || !this.sessionId || !this.connection) {
      throw new Error("AcpClient: not running");
    }

    this.currentResponseId = responseMessageId;

    const promptBlocks: ContentBlock[] = [{ type: "text", text: content }];

    try {
      const response = await this.connection.prompt({
        sessionId: this.sessionId,
        prompt: promptBlocks,
      });

      const stopReason = response.stopReason;
      this.emit("streamingComplete", responseMessageId, stopReason);
      this.currentResponseId = null;
      return stopReason;
    } catch (err) {
      this.currentResponseId = null;
      throw err;
    }
  }

  /**
   * Create a new ACP session, replacing the active one.
   */
  async createSession(): Promise<string> {
    if (this.state !== "running" || !this.connection) {
      throw new Error("AcpClient: not running");
    }

    const mcpServers: McpServer[] = (this.config.mcpServers ?? []).map((s) => ({
      type: "stdio" as const,
      name: s.name,
      command: s.command,
      args: s.args,
      env: (s.env ?? []).map((e) => ({ name: e.name, value: e.value })),
    }));

    const response = await this.connection.newSession({
      cwd: this.config.workspaceDir,
      mcpServers,
    });

    this.sessionId = response.sessionId;
    this.logger.info(`AcpClient: new session created ${this.sessionId}`);
    return this.sessionId;
  }

  /**
   * Cancel the current generation.
   */
  cancelGeneration(): void {
    if (!this.sessionId || !this.connection) {
      return;
    }

    this.connection.cancel({ sessionId: this.sessionId }).catch((err) => {
      this.logger.warn(`AcpClient: cancel failed: ${err}`);
    });
  }

  /**
   * Respond to a pending permission request from the agent.
   */
  respondToRequest(requestId: number, result: unknown): void {
    const resolver = this.pendingPermissionResolvers.get(requestId);
    if (resolver) {
      this.pendingPermissionResolvers.delete(requestId);
      resolver(result as RequestPermissionResponse);
    } else {
      this.logger.warn(`AcpClient: no pending permission for requestId ${requestId}`);
    }
  }

  /**
   * Stop the agent and clean up.
   */
  async stop(): Promise<void> {
    if (this.process === null) {
      this.setState("stopped");
      return;
    }

    this.logger.info("AcpClient: stopping...");

    // Reject pending permissions
    for (const [id, resolver] of this.pendingPermissionResolvers) {
      resolver({
        outcome: { outcome: "cancelled" as const },
      });
      this.pendingPermissionResolvers.delete(id);
    }

    const currentProcess = this.process;
    this.process = null;
    this.connection = null;

    await new Promise<void>((resolve) => {
      let killed = false;

      const forceKillTimer = setTimeout(() => {
        if (!killed && currentProcess.pid) {
          this.logger.warn("AcpClient: graceful shutdown timeout, sending SIGKILL");
          try {
            currentProcess.kill("SIGKILL");
          } catch {
            // Process may have already exited
          }
        }
      }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

      const cleanup = () => {
        killed = true;
        clearTimeout(forceKillTimer);
        resolve();
      };

      currentProcess.once("exit", cleanup);

      try {
        currentProcess.kill("SIGTERM");
      } catch {
        cleanup();
      }
    });

    this.sessionId = null;
    this.setState("stopped");
    this.logger.info("AcpClient: stopped");
  }

  dispose(): void {
    this.disposed = true;
    this.stop().catch(() => {});
    this.removeAllListeners();
  }

  // ─── Binary discovery ─────────────────────────────────────────────

  private async discoverBinary(): Promise<string> {
    // 1. Check configured path
    if (this.config.binaryPath) {
      if (await this.isValidCli(this.config.binaryPath)) {
        return this.config.binaryPath;
      }
      this.logger.warn(`AcpClient: configured path not valid CLI: ${this.config.binaryPath}`);
    }

    // 2. Check PATH
    const binaryName = this.config.binaryName;
    const execName = process.platform === "win32" ? `${binaryName}.exe` : binaryName;
    const pathDirs = (process.env.PATH || "").split(path.delimiter);

    for (const dir of pathDirs) {
      const candidate = path.join(dir, execName);
      if (await this.isValidCli(candidate)) {
        return candidate;
      }
    }

    // 3. Platform-specific locations
    const homeDir = os.homedir();
    const platformPaths =
      process.platform === "darwin"
        ? [
            path.join(homeDir, ".local", "bin", binaryName),
            `/usr/local/bin/${binaryName}`,
            `/opt/homebrew/bin/${binaryName}`,
          ]
        : process.platform === "linux"
          ? [
              path.join(homeDir, ".local", "bin", binaryName),
              `/usr/local/bin/${binaryName}`,
              `/usr/bin/${binaryName}`,
            ]
          : [
              path.join(process.env.LOCALAPPDATA || "", binaryName, execName),
              path.join(process.env.PROGRAMFILES || "", binaryName, execName),
            ];

    for (const candidate of platformPaths) {
      if (await this.isValidCli(candidate)) {
        return candidate;
      }
    }

    throw new Error(
      `${binaryName} binary not found. Install an ACP-compatible agent ` +
        `or set the path in settings (konveyor-core.experimentalChat.agentBinaryPath).`,
    );
  }

  private isValidCli(candidate: string): Promise<boolean> {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const child = execFile(
        candidate,
        ["--version"],
        { timeout: 3000 },
        (error, stdout, stderr) => {
          if (error) {
            resolve(false);
            return;
          }
          const output = (stdout || stderr || "").trim();
          resolve(/\d+\.\d+\.\d+/.test(output));
        },
      );
      child.on("error", () => resolve(false));
    });
  }

  private async checkVersion(binaryPath: string): Promise<void> {
    const minimumVersion = this.config.minimumVersion;

    return new Promise((resolve, reject) => {
      execFile(binaryPath, ["--version"], { timeout: 5000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Failed to check version: ${error.message}`));
          return;
        }

        const output = (stdout || stderr || "").trim();
        const match = output.match(/(\d+\.\d+\.\d+)/);

        if (!match) {
          this.logger.warn(
            `AcpClient: could not parse version from "${output}", proceeding anyway`,
          );
          resolve();
          return;
        }

        const version = match[1];
        if (this.compareVersions(version, minimumVersion) < 0) {
          reject(
            new Error(
              `Agent version ${version} is below minimum ${minimumVersion}. Please update.`,
            ),
          );
          return;
        }

        this.logger.info(`AcpClient: version ${version} (minimum: ${minimumVersion})`);
        resolve();
      });
    });
  }

  private compareVersions(a: string, b: string): number {
    const aParts = a.split(".").map(Number);
    const bParts = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      const diff = (aParts[i] || 0) - (bParts[i] || 0);
      if (diff !== 0) {
        return diff;
      }
    }
    return 0;
  }

  // ─── Subprocess + SDK connection ────────────────────────────────────

  private spawnAndConnect(binaryPath: string): void {
    const resolvedPath = fs.realpathSync(binaryPath);
    const args = this.config.binaryArgs;

    this.logger.info(
      `AcpClient: spawning ${resolvedPath} ${args.join(" ")} (cwd: ${this.config.workspaceDir})`,
    );

    const spawnEnv = this.config.modelEnv
      ? { ...process.env, ...this.config.modelEnv }
      : process.env;

    this.process = spawn(resolvedPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.config.workspaceDir,
      env: spawnEnv,
    });

    if (!this.process.stdin || !this.process.stdout) {
      throw new Error("AcpClient: failed to get stdin/stdout from process");
    }

    // Log stderr
    if (this.process.stderr) {
      this.process.stderr.on("data", (data: Buffer) => {
        const lines = data.toString("utf8").trim().split("\n");
        for (const line of lines) {
          if (line) {
            this.logger.debug(`AcpClient [stderr]: ${line}`);
          }
        }
      });
    }

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      this.logger.info(`AcpClient: process exited code=${code} signal=${signal}`);
      this.process = null;
      this.connection = null;

      if (this.state === "running") {
        this.setState("error");
        this.emit("error", new Error(`Agent process crashed (code=${code}, signal=${signal})`));
      }
    });

    this.process.on("error", (err) => {
      this.logger.error(`AcpClient: spawn error: ${err.message}`);
      this.setState("error");
      this.emit("error", err);
    });

    // Create the ACP SDK connection
    const output = Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>;
    const input = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(output, input);

    this.connection = new ClientSideConnection((_agent) => this.createClientHandler(), stream);
  }

  // ─── ACP Client handler ─────────────────────────────────────────────

  private createClientHandler(): Client {
    return {
      requestPermission: async (
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> => {
        return this.handlePermissionRequest(params);
      },

      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        this.handleSessionUpdate(params);
      },

      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        try {
          const content = fs.readFileSync(params.path, "utf-8");
          return { content };
        } catch {
          return { content: "" };
        }
      },

      writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        try {
          fs.writeFileSync(params.path, params.content, "utf-8");
          return {};
        } catch {
          return {};
        }
      },
    };
  }

  private async handlePermissionRequest(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const permissionId = this.nextPermissionId++;
    const toolCall = params.toolCall;

    const rawInput = toolCall.rawInput;

    const data: PermissionRequestData = {
      requestId: permissionId,
      toolCallId: toolCall.toolCallId,
      title: toolCall.title ?? "Tool call",
      kind: toolCall.kind ?? "other",
      status: toolCall.status ?? "pending",
      rawInput:
        rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
          ? (rawInput as Record<string, unknown>)
          : undefined,
      options: (params.options ?? []).map((o) => ({
        optionId: o.optionId,
        name: o.name,
        kind: o.kind as PermissionOption["kind"],
      })),
    };

    this.emit("permissionRequest", data);

    // Wait for the extension to call respondToRequest
    return new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingPermissionResolvers.set(permissionId, resolve);
    });
  }

  private handleSessionUpdate(params: SessionNotification): void {
    const update: SessionUpdate = params.update;
    if (!update) {
      return;
    }

    if (update.sessionUpdate === "agent_message_chunk" && this.currentResponseId) {
      this.handleContentChunk(update.content);
    } else if (update.sessionUpdate === "agent_thought_chunk" && this.currentResponseId) {
      const content = update.content;
      if (content.type === "text" && content.text) {
        this.emit("streamingChunk", this.currentResponseId, content.text, "thinking");
      }
    } else if (update.sessionUpdate === "tool_call" && this.currentResponseId) {
      const toolArgs = this.parseRawInput(update.rawInput);

      this.emit("toolCall", this.currentResponseId, {
        name: update.title || "Tool call",
        callId: update.toolCallId,
        arguments: toolArgs,
        status: "running",
      } satisfies ToolCallData);
    } else if (update.sessionUpdate === "tool_call_update" && this.currentResponseId) {
      const acpStatus = update.status;
      const resultText = this.extractToolCallResultText(update.content);

      this.emit("toolCallUpdate", this.currentResponseId, {
        name: update.title || "Tool call",
        callId: update.toolCallId,
        status:
          acpStatus === "completed" ? "succeeded" : acpStatus === "failed" ? "failed" : "running",
        result: resultText,
      } satisfies ToolCallData);
    }
  }

  private handleContentChunk(content: ContentBlock): void {
    switch (content.type) {
      case "text":
        if (content.text) {
          this.emit("streamingChunk", this.currentResponseId, content.text, "text");
        }
        break;
      case "resource_link":
        this.emit("streamingChunk", this.currentResponseId, "", "resource_link", {
          uri: content.uri,
          name: content.name,
          mimeType: content.mimeType ?? undefined,
        });
        break;
      case "resource": {
        const res = content.resource;
        this.emit("streamingChunk", this.currentResponseId, "", "resource", {
          uri: res.uri,
          text: "text" in res ? res.text : undefined,
          mimeType: res.mimeType ?? undefined,
        });
        break;
      }
    }
  }

  private parseRawInput(rawInput: unknown): Record<string, unknown> | undefined {
    if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
      return rawInput as Record<string, unknown>;
    }
    if (typeof rawInput === "string") {
      try {
        return JSON.parse(rawInput);
      } catch {
        // not valid JSON
      }
    }
    return undefined;
  }

  private extractToolCallResultText(
    content: Array<ToolCallContent> | null | undefined,
  ): string | undefined {
    if (!content) {
      return undefined;
    }
    for (const item of content) {
      if (item.type === "content" && item.content.type === "text") {
        return item.content.text;
      }
    }
    return undefined;
  }

  // ─── State management ─────────────────────────────────────────────

  private setState(newState: AgentState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit("stateChange", newState);
    }
  }
}
