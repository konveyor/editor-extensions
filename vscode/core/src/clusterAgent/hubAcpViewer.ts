/**
 * Viewer connection to a cluster AgentRun's ACP endpoint, through the Hub.
 *
 * The run's agent is driven by the migration harness, not by us. Through the
 * harness tee (agentic-controller ADR 0008), a viewer:
 *
 * - initializes and opens its own session, which stays silent: we never
 *   prompt it;
 * - receives the RUN's session/update notifications alongside its own, told
 *   apart by sessionId;
 * - receives the run's permission asks (session/request_permission, ids
 *   `kperm-<n>`) and questions (elicitation/create, from the ask_user tool,
 *   ids `kask-<n>`). The first viewer to answer wins. When an ask concludes
 *   elsewhere (another viewer, or the harness timing it out) the tee
 *   broadcasts a JSON-RPC response with the ask's id, and viewers must close
 *   it without answering.
 *
 * Wire protocol as in tackle2-ui's client/src/app/api/agentic/acp.ts:
 * JSON-RPC 2.0 text frames, requests in both directions.
 */
import { EventEmitter } from "events";

const PROTOCOL_VERSION = 1;
const VIEWER_CWD = "/workspace";
const REQUEST_TIMEOUT_MS = 30_000;

/** The subset of a WebSocket the viewer uses (`ws` and the WHATWG one both fit). */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(
    type: "close",
    listener: (event: { code: number; reason: string }) => void,
  ): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

/** A session/update from the run's session. */
export interface RunUpdate {
  sessionUpdate: string;
  [key: string]: unknown;
}

export interface PermissionAsk {
  /** JSON-RPC id the tee used (kperm-<n>); the answer must carry it. */
  askId: string | number;
  toolCall: {
    toolCallId: string;
    title?: string | null;
    kind?: string | null;
    status?: string | null;
    rawInput?: unknown;
    locations?: Array<{ path?: string }> | null;
  };
  options: Array<{ optionId: string; name: string; kind: string }>;
}

export interface ElicitationAsk {
  /** JSON-RPC id the tee used (kask-<n>). */
  askId: string | number;
  message: string;
  /** Flat form schema; the harness's ask_user sends one string `answer`. */
  requestedSchema?: {
    properties?: Record<string, { type?: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

export type PermissionResult =
  | { outcome: { outcome: "selected"; optionId: string } }
  | { outcome: { outcome: "cancelled" } };

export type ElicitationResult =
  | { action: "accept"; content: Record<string, string> }
  | { action: "decline" }
  | { action: "cancel" };

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Events:
 * - `update(update: RunUpdate, sessionId: string)` — the run's session
 * - `permission(ask: PermissionAsk)` — answer with respondPermission()
 * - `elicitation(ask: ElicitationAsk)` — answer with respondElicitation()
 * - `askResolved(askId, result)` — an ask concluded elsewhere; close it
 * - `close(code: number, reason: string)`
 */
export class HubAcpViewer extends EventEmitter {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  /** Asks we have shown and not answered, by JSON-RPC id. */
  private readonly openAsks = new Set<string | number>();
  private viewerSessionId: string | null = null;
  private closed = false;

  private constructor(private readonly socket: WebSocketLike) {
    super();
    socket.addEventListener("message", (event) => this.onMessage(event.data));
    socket.addEventListener("close", (event) => this.onClose(event.code, event.reason));
  }

  /** Open the socket, initialize, and open the viewer's own (silent) session. */
  static async connect(url: string, factory: WebSocketFactory): Promise<HubAcpViewer> {
    const socket = factory(url);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      socket.addEventListener("open", () => {
        settled = true;
        resolve();
      });
      socket.addEventListener("error", (event) => {
        if (!settled) {
          settled = true;
          reject(new Error(`ACP connection failed: ${describeError(event)}`));
        }
      });
      socket.addEventListener("close", (event) => {
        if (!settled) {
          settled = true;
          reject(new Error(`ACP connection closed during open (${event.code} ${event.reason})`));
        }
      });
    });
    const viewer = new HubAcpViewer(socket);
    await viewer.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    const session = (await viewer.request("session/new", { cwd: VIEWER_CWD, mcpServers: [] })) as {
      sessionId?: string;
    };
    viewer.viewerSessionId = session?.sessionId ?? null;
    return viewer;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  respondPermission(askId: string | number, result: PermissionResult): void {
    this.answer(askId, result);
  }

  respondElicitation(askId: string | number, result: ElicitationResult): void {
    this.answer(askId, result);
  }

  close(): void {
    if (!this.closed) {
      this.socket.close(1000, "viewer closed");
    }
  }

  private answer(askId: string | number, result: unknown): void {
    if (!this.openAsks.delete(askId) || this.closed) {
      return; // concluded elsewhere, or answered already
    }
    this.send({ jsonrpc: "2.0", id: askId, result });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ACP ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  private onMessage(data: unknown): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof data === "string" ? data : String(data));
    } catch {
      return;
    }
    const id = msg.id as string | number | undefined;
    const method = typeof msg.method === "string" ? msg.method : undefined;

    if (method && id !== undefined) {
      this.onRequest(id, method, (msg.params ?? {}) as Record<string, unknown>);
    } else if (method) {
      this.onNotification(method, (msg.params ?? {}) as Record<string, unknown>);
    } else if (id !== undefined) {
      this.onResponse(id, msg);
    }
  }

  private onRequest(id: string | number, method: string, params: Record<string, unknown>): void {
    if (method === "session/request_permission") {
      this.openAsks.add(id);
      this.emit("permission", {
        askId: id,
        toolCall: (params.toolCall ?? {}) as PermissionAsk["toolCall"],
        options: (params.options ?? []) as PermissionAsk["options"],
      } satisfies PermissionAsk);
      return;
    }
    if (method === "elicitation/create") {
      this.openAsks.add(id);
      this.emit("elicitation", {
        askId: id,
        message: typeof params.message === "string" ? params.message : "",
        requestedSchema: params.requestedSchema as ElicitationAsk["requestedSchema"],
      } satisfies ElicitationAsk);
      return;
    }
    // A viewer offers no fs/terminal capabilities.
    this.send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }

  private onNotification(method: string, params: Record<string, unknown>): void {
    if (method !== "session/update") {
      return; // e.g. goose's _goose/unstable/session/update usage counters
    }
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    const update = params.update as RunUpdate | undefined;
    if (!update || !sessionId || sessionId === this.viewerSessionId) {
      return; // our own session stays silent
    }
    this.emit("update", update, sessionId);
  }

  private onResponse(id: string | number, msg: Record<string, unknown>): void {
    if (typeof id === "number" && this.pending.has(id)) {
      const pending = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (msg.error) {
        const err = msg.error as { message?: string };
        pending.reject(new Error(err.message ?? "ACP error"));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }
    // The tee's broadcast that an ask concluded elsewhere.
    if (this.openAsks.delete(id)) {
      this.emit("askResolved", id, msg.result);
    }
  }

  private onClose(code: number, reason: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`ACP connection closed (${code})`));
    }
    this.pending.clear();
    this.openAsks.clear();
    this.emit("close", code, reason);
  }
}

function describeError(event: unknown): string {
  if (event && typeof event === "object") {
    const e = event as { message?: unknown; error?: { message?: unknown } };
    if (typeof e.message === "string") {
      return e.message;
    }
    if (e.error && typeof e.error.message === "string") {
      return e.error.message;
    }
  }
  return "unknown error";
}
