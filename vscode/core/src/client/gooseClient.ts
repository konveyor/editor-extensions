/**
 * GooseClient: ACP (Agent Communication Protocol) client for communicating
 * with the Goose AI agent via subprocess.
 *
 * Uses JSON-RPC 2.0 over stdio (ndjson framing) — the same protocol used by
 * block/vscode-goose. Spawns `goose acp` as a child process.
 *
 * @see docs/goose-acp-messaging-guide.md for protocol details
 */

import { ChildProcess, spawn, execFile } from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import winston from "winston";
import {
  GooseAgentState,
  GooseChatMessage,
  GooseContentBlockType,
} from "@editor-extensions/shared";

// ─── JSON-RPC 2.0 types ───────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

// ─── ACP protocol types ───────────────────────────────────────────────

interface AcpInitializeResponse {
  protocolVersion: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: {
      audio?: boolean;
      image?: boolean;
      embeddedContext?: boolean;
    };
  };
  agentInfo?: {
    name?: string;
    version?: string;
  };
}

interface AcpSessionNewResponse {
  sessionId: string;
}

interface AcpPromptResponse {
  stopReason: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
}

interface AcpContentBlock {
  type: "text" | "resource_link" | "resource" | "thinking";
  text?: string;
  thinking?: string;
  uri?: string;
  name?: string;
  mimeType?: string;
  resource?: { uri: string; text?: string; blob?: string; mimeType?: string };
}

interface AcpSessionUpdateParams {
  sessionId: string;
  update: {
    sessionUpdate: string;
    content?: AcpContentBlock;
  };
}

// ─── Pending request tracking ─────────────────────────────────────────

interface PendingRequest {
  id: number;
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Constants ────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 300_000; // 5 minutes for long ACP requests
const INITIALIZE_TIMEOUT_MS = 30_000;
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;
const MINIMUM_VERSION = "1.16.0";

// ─── GooseClient ──────────────────────────────────────────────────────

export interface GooseClientConfig {
  workspaceDir: string;
  logger: winston.Logger;
  gooseBinaryPath?: string | null;
  mcpServers?: Array<{
    name: string;
    type: "stdio";
    command: string;
    args: string[];
    env?: Array<{ name: string; value: string }>;
  }>;
  modelEnv?: Record<string, string>;
}

export interface StreamingResourceData {
  uri?: string;
  name?: string;
  mimeType?: string;
  text?: string;
}

export interface ToolCallData {
  name: string;
  callId?: string;
  arguments?: Record<string, unknown>;
  status: "running" | "succeeded" | "failed";
  result?: string;
}

export interface GooseClientEvents {
  stateChange: (state: GooseAgentState) => void;
  message: (message: GooseChatMessage) => void;
  streamingChunk: (
    messageId: string,
    content: string,
    contentType: GooseContentBlockType,
    resourceData?: StreamingResourceData,
  ) => void;
  streamingComplete: (messageId: string, stopReason: AcpPromptResponse["stopReason"]) => void;
  toolCall: (messageId: string, data: ToolCallData) => void;
  toolCallUpdate: (messageId: string, data: ToolCallData) => void;
  error: (error: Error) => void;
}

export class GooseClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: GooseAgentState = "stopped";
  private sessionId: string | null = null;
  private binaryPath: string | null = null;

  // JSON-RPC client state
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private buffer = "";
  private disposed = false;

  // Current streaming state
  private currentResponseId: string | null = null;

  private readonly config: GooseClientConfig;
  private readonly logger: winston.Logger;

  constructor(config: GooseClientConfig) {
    super();
    // Normalize workspaceDir — it may arrive as a file:// URI from vscode
    if (config.workspaceDir.startsWith("file://")) {
      config = { ...config, workspaceDir: new URL(config.workspaceDir).pathname };
    }
    this.config = config;
    this.logger = config.logger;
  }

  // ─── Public API ───────────────────────────────────────────────────

  getState(): GooseAgentState {
    return this.state;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Start the Goose agent: discover binary, check version, spawn process,
   * initialize ACP, and create a session.
   */
  async start(): Promise<void> {
    if (this.state === "running" || this.state === "starting") {
      this.logger.warn("GooseClient: already running or starting");
      return;
    }

    this.setState("starting");

    try {
      // 1. Discover the goose binary
      this.binaryPath = await this.discoverBinary();
      this.logger.info(`GooseClient: found binary at ${this.binaryPath}`);

      // 2. Check version
      await this.checkVersion(this.binaryPath);

      // 3. Spawn subprocess
      this.spawnProcess(this.binaryPath);

      // 4. ACP initialize
      const initResponse = await this.sendRequest<AcpInitializeResponse>(
        "initialize",
        {
          protocolVersion: 1,
          clientInfo: {
            name: "konveyor-vscode",
            version: "0.4.0",
          },
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
        },
        INITIALIZE_TIMEOUT_MS,
      );

      this.logger.info(`GooseClient: ACP initialized, protocol v${initResponse.protocolVersion}`);
      if (initResponse.agentInfo) {
        this.logger.info(
          `GooseClient: agent ${initResponse.agentInfo.name} v${initResponse.agentInfo.version}`,
        );
      }

      // 5. Create session
      const sessionResponse = await this.sendRequest<AcpSessionNewResponse>("session/new", {
        cwd: this.config.workspaceDir,
        mcpServers: this.config.mcpServers ?? [],
      });

      this.sessionId = sessionResponse.sessionId;
      this.logger.info(`GooseClient: session created ${this.sessionId}`);

      this.setState("running");
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`GooseClient: start failed: ${error.message}`);
      this.setState("error");
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Send a user message to Goose and stream the response.
   * Returns the stop reason when generation completes.
   */
  async sendMessage(
    content: string,
    responseMessageId: string,
  ): Promise<AcpPromptResponse["stopReason"]> {
    if (this.state !== "running" || !this.sessionId) {
      throw new Error("GooseClient: not running");
    }

    this.currentResponseId = responseMessageId;

    const promptBlocks: AcpContentBlock[] = [{ type: "text", text: content }];

    try {
      const response = await this.sendRequest<AcpPromptResponse>(
        "session/prompt",
        {
          sessionId: this.sessionId,
          prompt: promptBlocks,
        },
        REQUEST_TIMEOUT_MS,
      );

      this.emit("streamingComplete", responseMessageId, response.stopReason);
      this.currentResponseId = null;
      return response.stopReason;
    } catch (err) {
      this.currentResponseId = null;
      throw err;
    }
  }

  /**
   * Cancel the current generation.
   */
  cancelGeneration(): void {
    if (!this.sessionId) {
      return;
    }

    this.sendNotification("session/cancel", { sessionId: this.sessionId });
  }

  /**
   * Whether a prompt is currently in flight.
   */
  isPromptActive(): boolean {
    return this.currentResponseId !== null;
  }

  /**
   * Stop the agent and clean up.
   */
  async stop(): Promise<void> {
    if (this.process === null) {
      this.setState("stopped");
      return;
    }

    this.logger.info("GooseClient: stopping...");

    // Dispose JSON-RPC client
    this.disposeRpcClient();

    // Graceful shutdown
    const currentProcess = this.process;
    this.process = null;

    await new Promise<void>((resolve) => {
      let killed = false;

      const forceKillTimer = setTimeout(() => {
        if (!killed && currentProcess.pid) {
          this.logger.warn("GooseClient: graceful shutdown timeout, sending SIGKILL");
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
    this.logger.info("GooseClient: stopped");
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.disposed = true;
    this.stop().catch(() => {});
    this.removeAllListeners();
  }

  // ─── Binary discovery ─────────────────────────────────────────────

  private async discoverBinary(): Promise<string> {
    // 1. Check configured path
    if (this.config.gooseBinaryPath) {
      try {
        fs.accessSync(this.config.gooseBinaryPath, fs.constants.X_OK);
        return this.config.gooseBinaryPath;
      } catch {
        this.logger.warn(
          `GooseClient: configured path not accessible: ${this.config.gooseBinaryPath}`,
        );
      }
    }

    // 2. Check PATH
    const pathDirs = (process.env.PATH || "").split(path.delimiter);
    const binaryName = process.platform === "win32" ? "goose.exe" : "goose";

    for (const dir of pathDirs) {
      const candidate = path.join(dir, binaryName);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Not found in this directory
      }
    }

    // 3. Platform-specific locations
    const homeDir = os.homedir();
    const platformPaths =
      process.platform === "darwin"
        ? [
            "/Applications/Goose.app/Contents/MacOS/goose",
            path.join(homeDir, ".local", "bin", "goose"),
            "/usr/local/bin/goose",
            "/opt/homebrew/bin/goose",
          ]
        : process.platform === "linux"
          ? [
              path.join(homeDir, ".local", "bin", "goose"),
              "/usr/local/bin/goose",
              "/usr/bin/goose",
              "/usr/share/goose/bin/goose",
            ]
          : [
              // Windows
              path.join(process.env.LOCALAPPDATA || "", "Goose", "goose.exe"),
              path.join(process.env.PROGRAMFILES || "", "Goose", "goose.exe"),
            ];

    for (const candidate of platformPaths) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Not found
      }
    }

    throw new Error(
      "Goose binary not found. Install Goose (https://block.github.io/goose/docs/quickstart) " +
        "or set the path in settings (konveyor-core.experimentalChat.gooseBinaryPath).",
    );
  }

  private async checkVersion(binaryPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(binaryPath, ["--version"], { timeout: 5000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Failed to check goose version: ${error.message}`));
          return;
        }

        const output = (stdout || stderr || "").trim();
        // Parse version from various formats: "goose 1.16.0", "v1.16.0", "1.16.0"
        const match = output.match(/(\d+\.\d+\.\d+)/);

        if (!match) {
          this.logger.warn(
            `GooseClient: could not parse version from "${output}", proceeding anyway`,
          );
          resolve();
          return;
        }

        const version = match[1];
        if (this.compareVersions(version, MINIMUM_VERSION) < 0) {
          reject(
            new Error(
              `Goose version ${version} is below minimum ${MINIMUM_VERSION}. ` +
                `Please update: https://block.github.io/goose/docs/quickstart`,
            ),
          );
          return;
        }

        this.logger.info(`GooseClient: version ${version} (minimum: ${MINIMUM_VERSION})`);
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

  // ─── Subprocess management ────────────────────────────────────────

  private spawnProcess(binaryPath: string): void {
    // Resolve symlinks — Node.js spawn can fail with ENOENT on Homebrew
    // symlinks in the VS Code extension host environment.
    const resolvedPath = fs.realpathSync(binaryPath);
    this.logger.info(
      `GooseClient: spawning ${resolvedPath} acp (cwd: ${this.config.workspaceDir})`,
    );

    const spawnEnv = this.config.modelEnv
      ? { ...process.env, ...this.config.modelEnv }
      : process.env;

    this.process = spawn(resolvedPath, ["acp"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.config.workspaceDir,
      env: spawnEnv,
    });

    if (!this.process.stdin || !this.process.stdout) {
      throw new Error("GooseClient: failed to get stdin/stdout from process");
    }

    // Set up ndjson parser on stdout
    this.process.stdout.on("data", (chunk: Buffer) => {
      if (this.disposed) {
        return;
      }

      this.buffer += chunk.toString("utf8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          this.handleIncomingLine(trimmed);
        }
      }
    });

    // Log stderr
    if (this.process.stderr) {
      this.process.stderr.on("data", (data: Buffer) => {
        const lines = data.toString("utf8").trim().split("\n");
        for (const line of lines) {
          if (line) {
            this.logger.debug(`GooseClient [stderr]: ${line}`);
          }
        }
      });
    }

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      this.logger.info(`GooseClient: process exited code=${code} signal=${signal}`);

      this.disposeRpcClient();
      this.process = null;

      if (this.state === "running") {
        // Unexpected crash
        this.setState("error");
        this.emit("error", new Error(`Goose process crashed (code=${code}, signal=${signal})`));
      }
    });

    this.process.on("error", (err) => {
      this.logger.error(`GooseClient: spawn error: ${err.message}`);
      this.setState("error");
      this.emit("error", err);
    });
  }

  // ─── JSON-RPC 2.0 client ─────────────────────────────────────────

  private handleIncomingLine(line: string): void {
    let message: JsonRpcResponse | JsonRpcNotification;
    try {
      message = JSON.parse(line);
    } catch {
      this.logger.warn(`GooseClient: failed to parse JSON: ${line.substring(0, 200)}`);
      return;
    }

    // Response (has id)
    if ("id" in message && message.id !== undefined) {
      const response = message as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(response.id);

        if (response.error) {
          pending.reject(
            new Error(`JSON-RPC error (${response.error.code}): ${response.error.message}`),
          );
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Notification (no id)
    const notification = message as JsonRpcNotification;
    this.handleNotification(notification);
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method !== "session/update") {
      return;
    }

    const params = notification.params as AcpSessionUpdateParams | undefined;
    if (!params?.update) {
      return;
    }

    const { sessionUpdate, content } = params.update;

    if (sessionUpdate === "agent_message_chunk" && this.currentResponseId) {
      switch (content?.type) {
        case "text":
          if (content.text) {
            this.emit("streamingChunk", this.currentResponseId, content.text, "text");
          }
          break;
        case "resource_link":
          this.emit("streamingChunk", this.currentResponseId, "", "resource_link", {
            uri: content.uri,
            name: content.name,
            mimeType: content.mimeType,
          });
          break;
        case "resource":
          this.emit("streamingChunk", this.currentResponseId, "", "resource", {
            uri: content.resource?.uri,
            text: content.resource?.text,
            name: content.name,
            mimeType: content.mimeType,
          });
          break;
        case "thinking":
          if (content.thinking || content.text) {
            this.emit(
              "streamingChunk",
              this.currentResponseId,
              content.thinking || content.text,
              "thinking",
            );
          }
          break;
        default:
          if (content) {
            this.logger.info(
              `GooseClient: unhandled content type in agent_message_chunk: ${content.type}`,
            );
          }
          break;
      }
    } else if (sessionUpdate === "tool_call" && this.currentResponseId) {
      const update = params.update as Record<string, unknown>;
      this.emit("toolCall", this.currentResponseId, {
        name: (update.title as string) || (update.name as string) || "Tool call",
        callId: (update.toolCallId as string) || (update.id as string),
        status: "running",
      });
    } else if (sessionUpdate === "tool_call_update" && this.currentResponseId) {
      const update = params.update as Record<string, unknown>;
      const acpStatus = update.status as string;
      this.emit("toolCallUpdate", this.currentResponseId, {
        name: (update.title as string) || (update.name as string) || "Tool call",
        callId: (update.toolCallId as string) || (update.id as string),
        status:
          acpStatus === "completed" ? "succeeded" : acpStatus === "failed" ? "failed" : "running",
        result: content?.text,
      });
    } else if (sessionUpdate !== "agent_message_chunk") {
      this.logger.info(`GooseClient: unhandled sessionUpdate type: ${sessionUpdate}`, {
        hasContent: !!content,
        update: JSON.stringify(params.update).substring(0, 500),
      });
    }
  }

  private sendRequest<T>(
    method: string,
    params?: unknown,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.disposed || !this.process?.stdin) {
        reject(new Error("GooseClient: not connected"));
        return;
      }

      const id = this.nextRequestId++;

      const timer = setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          reject(new Error(`GooseClient: request ${method} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const entry: PendingRequest = {
        id,
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      };

      this.pendingRequests.set(id, entry);

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        ...(params !== undefined && { params }),
      };

      const requestLine = JSON.stringify(request) + "\n";

      this.process.stdin.write(requestLine, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(new Error(`GooseClient: write error: ${err.message}`));
        }
      });
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    if (this.disposed || !this.process?.stdin) {
      return;
    }

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      ...(params !== undefined && { params }),
    };

    const line = JSON.stringify(notification) + "\n";
    this.process.stdin.write(line);
  }

  private disposeRpcClient(): void {
    // Reject all pending requests
    for (const [id, entry] of this.pendingRequests) {
      clearTimeout(entry.timer);
      entry.reject(new Error("GooseClient: client disposed"));
      this.pendingRequests.delete(id);
    }

    this.buffer = "";
  }

  // ─── State management ─────────────────────────────────────────────

  private setState(newState: GooseAgentState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit("stateChange", newState);
    }
  }
}
