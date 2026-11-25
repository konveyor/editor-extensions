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
import { fileURLToPath } from "url";
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
  PromptResponse,
  SessionModeState,
  SessionUpdate,
  ToolCallContent,
  ToolCallLocation,
} from "@agentclientprotocol/sdk";
import type { AgentPermissionMode, AgentState } from "@editor-extensions/shared";
import type {
  AgentBackendClient,
  McpServerConfig,
  PermissionRequestData,
  PermissionOption,
  SendMessageOptions,
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
  SendMessageOptions,
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
  /** How long a cancelled prompt may take to settle before it is detached. */
  promptSettleTimeoutMs?: number;
}

// ─── Constants ────────────────────────────────────────────────────────

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5_000;
/** How long to wait for a cancelled prompt to settle before starting a new one. */
const PROMPT_SETTLE_TIMEOUT_MS = 10_000;

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

  // Current streaming state. `inflightPrompt` is the `session/prompt` call
  // that is still awaiting its response; `currentResponseId` is the message
  // id its session updates are attributed to.
  private currentResponseId: string | null = null;
  private inflightPrompt: Promise<unknown> | null = null;
  // Releases the sendMessage() call of the in-flight prompt as "cancelled"
  // when that prompt is detached after the settle timeout, so callers
  // waiting on it (the Get Solution run, and Stop through it) cannot hang on
  // an agent that never answers session/cancel.
  private releaseInflight: (() => void) | null = null;
  // The prompt being cancelled, until it settles. A permission request the
  // agent sends for it in that window is answered "cancelled" at once.
  private cancellingPrompt: Promise<unknown> | null = null;

  // ACP session modes the agent advertises for the current session (Goose:
  // auto, approve, smart_approve, chat) and the one in effect.
  private availableModeIds: string[] = [];
  private currentModeId: string | null = null;
  // Permission mode to apply to every session this client creates, or null
  // to leave the agent's own configured mode alone.
  private desiredPermissionMode: AgentPermissionMode | null = null;

  // Sends are serialized through this chain so that each queued message
  // cancels/settles the prompt that is actually active when its turn comes,
  // not the one that was active when it was requested.
  private sendChain: Promise<unknown> = Promise.resolve();
  private queuedSends = 0;
  // Bumped by interruptSends(); a queued send whose epoch is stale drops out
  // instead of dispatching, so a takeover cannot be followed by a stray
  // freeform prompt on the new session.
  private sendEpoch = 0;

  private readonly config: AcpClientConfig;
  private readonly logger: winston.Logger;

  constructor(config: AcpClientConfig) {
    super();
    if (config.workspaceDir.startsWith("file://")) {
      // fileURLToPath decodes percent escapes (a URL's pathname keeps
      // "My%20Project"), which the agent needs as a real cwd.
      config = { ...config, workspaceDir: fileURLToPath(config.workspaceDir) };
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
      this.captureModes(sessionResponse.modes);
      await this.applyDesiredPermissionMode();

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
   *
   * Sends are serialized. When no prompt is active the message goes on the
   * wire synchronously, so `isPromptActive()` is true as soon as this method
   * returns. Otherwise the send is queued behind earlier sends; when its turn
   * comes it settles whichever prompt is active at that moment — cancelling
   * it first with `replaceActive` — so a late completion of an older prompt
   * can never clobber the response state of the one started here, and no
   * two prompts are ever in flight at once.
   */
  async sendMessage(
    content: string,
    responseMessageId: string,
    options: SendMessageOptions = {},
  ): Promise<string> {
    this.assertRunning();
    const epoch = this.sendEpoch;

    let promptCall: Promise<PromptResponse> | null;
    const idle = !this.inflightPrompt && this.queuedSends === 0;
    // With nothing in flight the hook runs right away; if it is synchronous
    // the prompt still goes on the wire before this method returns.
    const prep = idle ? options.beforeDispatch?.() : undefined;
    if (idle && !prep) {
      promptCall = this.dispatchPrompt(content, responseMessageId);
    } else {
      this.queuedSends++;
      const turn = this.sendChain.then(async () => {
        try {
          if (this.sendEpoch !== epoch) {
            return { call: null };
          }
          if (this.inflightPrompt) {
            if (options.replaceActive) {
              await this.cancelGeneration();
            } else {
              await this.waitForPromptToSettle();
            }
          }
          if (this.sendEpoch !== epoch) {
            // Interrupted while we were settling the previous prompt.
            return { call: null };
          }
          const ready = prep ?? options.beforeDispatch?.();
          if (ready) {
            await ready;
          }
          // Last check, with nothing awaited between it and dispatchPrompt:
          // interruptSends() may have run while the hook was pending.
          if (this.sendEpoch !== epoch) {
            return { call: null };
          }
          this.assertRunning();
          // Wrapped so the async function does not flatten the prompt promise
          // (that would make the queue wait for the prompt to *complete*).
          return { call: this.dispatchPrompt(content, responseMessageId) };
        } finally {
          this.queuedSends--;
        }
      });
      this.sendChain = turn.then(
        () => undefined,
        () => undefined,
      );
      promptCall = (await turn).call;
    }

    if (!promptCall) {
      this.logger.info("AcpClient: queued prompt dropped by interruptSends", {
        responseMessageId,
      });
      this.emit("streamingComplete", responseMessageId, "cancelled");
      return "cancelled";
    }

    try {
      const response = await Promise.race([promptCall, this.releasedPromise(promptCall)]);
      const stopReason = response.stopReason;
      this.emit("streamingComplete", responseMessageId, stopReason);
      return stopReason;
    } finally {
      // Only clear state that still belongs to this prompt. A replacement
      // prompt may already have taken over after a cancel.
      if (this.inflightPrompt === promptCall) {
        this.inflightPrompt = null;
      }
      if (this.currentResponseId === responseMessageId) {
        this.currentResponseId = null;
      }
    }
  }

  /** Put a prompt on the wire and make it the active one. Synchronous. */
  private dispatchPrompt(content: string, responseMessageId: string): Promise<PromptResponse> {
    this.currentResponseId = responseMessageId;
    const promptBlocks: ContentBlock[] = [{ type: "text", text: content }];
    const promptCall = this.connection!.prompt({
      sessionId: this.sessionId!,
      prompt: promptBlocks,
    });
    this.inflightPrompt = promptCall;
    this.releaseInflight = null;
    return promptCall;
  }

  /**
   * Resolves `{ stopReason: "cancelled" }` if `promptCall` is detached before
   * it settles (settle timeout, or stop()). Never resolves otherwise.
   */
  private releasedPromise(promptCall: Promise<unknown>): Promise<PromptResponse> {
    return new Promise<PromptResponse>((resolve) => {
      if (this.inflightPrompt === promptCall) {
        this.releaseInflight = () => resolve({ stopReason: "cancelled" });
      }
    });
  }

  /** Detach the in-flight prompt and release whoever is awaiting it. */
  private detachInflight(): void {
    const release = this.releaseInflight;
    this.releaseInflight = null;
    this.inflightPrompt = null;
    this.currentResponseId = null;
    release?.();
  }

  private assertRunning(): void {
    if (this.state !== "running" || !this.sessionId || !this.connection) {
      throw new Error("AcpClient: not running");
    }
  }

  /**
   * Wait for the in-flight prompt (if any) to finish, bounded by
   * PROMPT_SETTLE_TIMEOUT_MS. If it never settles we drop our reference so
   * a new prompt can proceed; the stale call can no longer touch shared state.
   */
  private async waitForPromptToSettle(): Promise<void> {
    const inflight = this.inflightPrompt;
    if (!inflight) {
      return;
    }

    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      inflight.then(
        () => false,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(
          () => resolve(true),
          this.config.promptSettleTimeoutMs ?? PROMPT_SETTLE_TIMEOUT_MS,
        );
      }),
    ]);
    clearTimeout(timer);

    if (timedOut && this.inflightPrompt === inflight) {
      this.logger.warn("AcpClient: previous prompt did not settle after cancel; detaching it");
      this.detachInflight();
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
    this.captureModes(response.modes);
    await this.applyDesiredPermissionMode();
    return response.sessionId;
  }

  // ─── Permission mode (ACP session modes) ──────────────────────────

  /**
   * The current session's mode and whether the agent can switch between the
   * `auto` and `approve` permission modes.
   */
  getPermissionModeState(): { current: string | null; supported: boolean } {
    return {
      current: this.currentModeId,
      supported:
        this.availableModeIds.includes("auto") && this.availableModeIds.includes("approve"),
    };
  }

  /**
   * Set the permission mode for the current session and every session created
   * after it. `null` stops overriding: later sessions keep the agent's own
   * configured mode (the current session is left as it is). Has no effect on
   * agents that do not advertise the mode.
   */
  async setPermissionMode(mode: AgentPermissionMode | null): Promise<void> {
    this.desiredPermissionMode = mode;
    if (this.state === "running") {
      await this.applyDesiredPermissionMode();
    }
  }

  private captureModes(modes: SessionModeState | null | undefined): void {
    this.availableModeIds = (modes?.availableModes ?? []).map((m) => m.id);
    this.currentModeId = modes?.currentModeId ?? null;
    this.emitModeChange();
  }

  /**
   * Switch the current session to the desired mode, if one is set, the agent
   * offers it, and it is not already in effect. A failure is logged and
   * leaves the session in the agent's mode; it never fails session setup.
   */
  private async applyDesiredPermissionMode(): Promise<void> {
    const mode = this.desiredPermissionMode;
    const sessionId = this.sessionId;
    if (!mode || !sessionId || !this.connection || this.currentModeId === mode) {
      return;
    }
    if (!this.availableModeIds.includes(mode)) {
      this.logger.info(`AcpClient: agent does not offer mode "${mode}"; leaving its own mode`);
      return;
    }
    try {
      await this.connection.setSessionMode({ sessionId, modeId: mode });
      if (this.sessionId === sessionId) {
        this.currentModeId = mode;
        this.emitModeChange();
      }
      this.logger.info(`AcpClient: session ${sessionId} mode set to ${mode}`);
    } catch (err) {
      this.logger.warn(`AcpClient: failed to set session mode "${mode}": ${err}`);
    }
  }

  private clearModes(): void {
    this.availableModeIds = [];
    this.currentModeId = null;
    this.emitModeChange();
  }

  private emitModeChange(): void {
    this.emit("permissionModeChange", this.getPermissionModeState());
  }

  /**
   * Cancel the current generation. Resolves once the cancelled prompt has
   * actually completed (or the settle timeout elapsed), so callers can safely
   * start a new prompt afterwards.
   */
  async cancelGeneration(): Promise<void> {
    if (!this.sessionId || !this.connection) {
      return;
    }

    const cancelling = this.inflightPrompt;
    this.cancellingPrompt = cancelling;
    try {
      try {
        await this.connection.cancel({ sessionId: this.sessionId });
      } catch (err) {
        this.logger.warn(`AcpClient: cancel failed: ${err}`);
      }

      // ACP prompt-turn spec: after session/cancel the Client MUST answer
      // every pending session/request_permission with the `cancelled`
      // outcome. An agent blocked on one cannot end its turn otherwise, so
      // the cancelled prompt would only "settle" via the timeout below.
      // Requests that arrive until it settles are answered the same way
      // (see handlePermissionRequest).
      this.cancelPendingPermissions();

      await this.waitForPromptToSettle();
    } finally {
      if (this.cancellingPrompt === cancelling) {
        this.cancellingPrompt = null;
      }
    }
  }

  /**
   * Answer every pending permission request with `cancelled` and emit
   * `permissionsCancelled(requestIds)` so the UI can retire their cards.
   */
  private cancelPendingPermissions(): void {
    if (this.pendingPermissionResolvers.size === 0) {
      return;
    }
    const requestIds = Array.from(this.pendingPermissionResolvers.keys());
    for (const [id, resolver] of this.pendingPermissionResolvers) {
      this.pendingPermissionResolvers.delete(id);
      resolver({ outcome: { outcome: "cancelled" } });
    }
    this.emit("permissionsCancelled", requestIds);
  }

  /**
   * Stop all freeform work before a takeover (Get Solution replacing the
   * session and listeners): cancel the active prompt, drop every queued send,
   * and resolve once nothing is in flight or queued. Dropped sends resolve
   * with stop reason "cancelled" and emit `streamingComplete` for their id.
   */
  async interruptSends(): Promise<void> {
    this.sendEpoch++;
    if (this.inflightPrompt) {
      await this.cancelGeneration();
    }
    // Queued turns observe the new epoch and drop out; wait for the chain
    // to run dry (a turn mid-settle finishes its wait first).
    while (this.queuedSends > 0) {
      await this.sendChain;
    }
  }

  /**
   * Whether a permission request is still awaiting an answer. False once it
   * was answered, or cancelled by `cancelGeneration()` / `stop()`.
   */
  isPermissionPending(requestId: number): boolean {
    return this.pendingPermissionResolvers.has(requestId);
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
    // A send still queued (or parked in its beforeDispatch hook) must not
    // dispatch onto whatever session a later start() creates.
    this.sendEpoch++;

    if (this.process === null) {
      // Already exited (crash, or a stop in progress): still answer pending
      // permissions and release anyone awaiting the in-flight prompt.
      this.cancelPendingPermissions();
      this.cancellingPrompt = null;
      this.detachInflight();
      this.clearModes();
      this.setState("stopped");
      return;
    }

    this.logger.info("AcpClient: stopping...");

    this.cancelPendingPermissions();

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
    this.cancellingPrompt = null;
    this.detachInflight();
    this.clearModes();
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
      locations: this.extractLocations(toolCall.locations),
      options: (params.options ?? []).map((o) => ({
        optionId: o.optionId,
        name: o.name,
        kind: o.kind as PermissionOption["kind"],
      })),
    };

    // A request for a session we no longer drive, or for a prompt that is
    // being cancelled, is answered "cancelled" without asking the user
    // (ACP prompt-turn spec: a cancelled turn's permissions get `cancelled`).
    const forCancelledTurn =
      this.cancellingPrompt !== null && this.cancellingPrompt === this.inflightPrompt;
    if (params.sessionId !== this.sessionId || forCancelledTurn) {
      this.logger.info("AcpClient: answering permission request for a cancelled turn", {
        toolCallId: data.toolCallId,
      });
      return { outcome: { outcome: "cancelled" } };
    }

    // Register before announcing it: listeners check isPermissionPending()
    // and may run synchronously inside emit().
    const answer = new Promise<RequestPermissionResponse>((resolve) => {
      this.pendingPermissionResolvers.set(permissionId, resolve);
    });
    this.emit("permissionRequest", data);
    return answer;
  }

  private handleSessionUpdate(params: SessionNotification): void {
    const update: SessionUpdate = params.update;
    if (!update) {
      return;
    }
    // Late updates from a replaced session (e.g. a detached freeform turn
    // after Get Solution created its own session) must not be attributed to
    // the current prompt.
    if (params.sessionId !== this.sessionId) {
      return;
    }

    // The agent changed the session's mode (ours or its own decision).
    if (update.sessionUpdate === "current_mode_update") {
      this.currentModeId = update.currentModeId;
      this.emitModeChange();
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
      this.emit("toolCall", this.currentResponseId, {
        name: update.title || "Tool call",
        callId: update.toolCallId,
        arguments: this.parseRawInput(update.rawInput),
        locations: this.extractLocations(update.locations),
        status: "running",
      } satisfies ToolCallData);
    } else if (update.sessionUpdate === "tool_call_update" && this.currentResponseId) {
      const acpStatus = update.status;
      const resultText = this.extractToolCallResultText(update.content);

      // Keep rawInput/locations on updates: OpenCode's initial `tool_call` is
      // empty and only its `tool_call_update`s say which file is being edited.
      this.emit("toolCallUpdate", this.currentResponseId, {
        name: update.title || "Tool call",
        callId: update.toolCallId,
        arguments: this.parseRawInput(update.rawInput),
        locations: this.extractLocations(update.locations),
        status:
          acpStatus === "completed" ? "succeeded" : acpStatus === "failed" ? "failed" : "running",
        result: resultText,
      } satisfies ToolCallData);
    }
  }

  private extractLocations(
    locations: Array<ToolCallLocation> | null | undefined,
  ): string[] | undefined {
    if (!locations || locations.length === 0) {
      return undefined;
    }
    const paths = locations.map((l) => l.path).filter((p): p is string => typeof p === "string");
    return paths.length > 0 ? paths : undefined;
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
