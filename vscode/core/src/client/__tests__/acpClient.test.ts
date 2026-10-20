import expect from "expect";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import winston from "winston";
import { AcpClient } from "../acpClient";

const silentLogger = winston.createLogger({ silent: true, transports: [] });

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Builds a client in the "running" state with a fake ACP connection so the
 * prompt lifecycle can be driven without spawning a process.
 */
function runningClient(
  options: { promptSettleTimeoutMs?: number; agentIgnoresCancel?: boolean } = {},
) {
  const client = new AcpClient({
    workspaceDir: "/tmp/ws",
    logger: silentLogger,
    binaryName: "fake",
    binaryArgs: ["acp"],
    minimumVersion: "0.0.0",
    promptSettleTimeoutMs: options.promptSettleTimeoutMs,
  });

  const prompts: Array<{ text: string; done: Deferred<{ stopReason: string }> }> = [];
  const cancels: string[] = [];
  const connection = {
    prompt: (params: { sessionId: string; prompt: Array<{ text: string }> }) => {
      const done = deferred<{ stopReason: string }>();
      prompts.push({ text: params.prompt[0].text, done });
      return done.promise;
    },
    cancel: async (params: { sessionId: string }) => {
      cancels.push(params.sessionId);
      // Like a real agent, the cancelled prompt resolves shortly after the
      // cancel notification — not synchronously inside it.
      const current = prompts[prompts.length - 1];
      if (!options.agentIgnoresCancel) {
        setTimeout(() => current?.done.resolve({ stopReason: "cancelled" }), 5);
      }
    },
  };

  const settle = () => new Promise((r) => setImmediate(r));

  const internals = client as unknown as {
    state: string;
    sessionId: string | null;
    connection: unknown;
  };
  internals.state = "running";
  internals.sessionId = "session-1";
  internals.connection = connection;

  const emitUpdate = (update: Record<string, unknown>) => {
    (client as unknown as { handleSessionUpdate: (p: unknown) => void }).handleSessionUpdate({
      sessionId: "session-1",
      update,
    });
  };

  return { client, prompts, cancels, emitUpdate, settle };
}

/** What the AGENT_SEND_MESSAGE handler does: cancel-and-send. */
function chatSend(client: AcpClient, text: string, id: string): Promise<string> {
  return client.sendMessage(text, id, { replaceActive: true });
}

describe("AcpClient prompt lifecycle", () => {
  it("attributes session updates to the active prompt and clears state on completion", async () => {
    const { client, prompts, emitUpdate } = runningClient();
    const chunks: Array<[string, string]> = [];
    client.on("streamingChunk", (id: string, text: string) => chunks.push([id, text]));
    const completes: Array<[string, string]> = [];
    client.on("streamingComplete", (id: string, reason: string) => completes.push([id, reason]));

    const sending = client.sendMessage("hello", "A");
    expect(client.isPromptActive()).toBe(true);
    emitUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } });

    prompts[0].done.resolve({ stopReason: "end_turn" });
    expect(await sending).toBe("end_turn");
    expect(chunks).toEqual([["A", "hi"]]);
    expect(completes).toEqual([["A", "end_turn"]]);
    expect(client.isPromptActive()).toBe(false);
  });

  it("cancel-and-send keeps the replacement prompt's response state", async () => {
    const { client, prompts, cancels, emitUpdate } = runningClient();
    const chunks: Array<[string, string]> = [];
    client.on("streamingChunk", (id: string, text: string) => chunks.push([id, text]));

    const first = client.sendMessage("first", "A");
    await client.cancelGeneration();
    expect(cancels).toEqual(["session-1"]);
    expect(await first).toBe("cancelled");

    const second = client.sendMessage("second", "B");
    await new Promise((r) => setImmediate(r));
    expect(prompts).toHaveLength(2);
    expect(client.isPromptActive()).toBe(true);

    emitUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "two" } });
    expect(chunks).toEqual([["B", "two"]]);

    prompts[1].done.resolve({ stopReason: "end_turn" });
    expect(await second).toBe("end_turn");
    expect(client.isPromptActive()).toBe(false);
  });

  it("waits for a cancelled prompt to settle even when cancel is not awaited", async () => {
    const { client, prompts, emitUpdate } = runningClient();
    const chunks: Array<[string, string]> = [];
    client.on("streamingChunk", (id: string, text: string) => chunks.push([id, text]));

    const first = client.sendMessage("first", "A");
    void client.cancelGeneration();
    const second = client.sendMessage("second", "B");

    // The second prompt is not sent until the first one has completed.
    expect(prompts).toHaveLength(1);
    expect(await first).toBe("cancelled");
    await new Promise((r) => setImmediate(r));
    expect(prompts).toHaveLength(2);

    // The first prompt's completion must not have cleared B's state.
    expect(client.isPromptActive()).toBe(true);
    emitUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "two" } });
    expect(chunks).toEqual([["B", "two"]]);

    prompts[1].done.resolve({ stopReason: "end_turn" });
    await second;
  });

  it("three quick messages replace each other in order with one prompt in flight", async () => {
    const { client, prompts, cancels, emitUpdate, settle } = runningClient();
    const chunks: Array<[string, string]> = [];
    client.on("streamingChunk", (id: string, text: string) => chunks.push([id, text]));
    const completes: Array<[string, string]> = [];
    client.on("streamingComplete", (id: string, reason: string) => completes.push([id, reason]));

    const a = chatSend(client, "A", "A");
    const b = chatSend(client, "B", "B");
    const c = chatSend(client, "C", "C");

    // Only A is on the wire; B and C are queued behind it.
    expect(prompts.map((p) => p.text)).toEqual(["A"]);
    expect(client.isPromptActive()).toBe(true);

    // B's turn cancels A. C must wait until B is actually active, then cancel
    // *B* — not re-cancel A and then start alongside B.
    expect(await a).toBe("cancelled");
    await settle();
    expect(prompts.map((p) => p.text)).toEqual(["A", "B"]);
    expect(await b).toBe("cancelled");
    await settle();
    expect(prompts.map((p) => p.text)).toEqual(["A", "B", "C"]);
    expect(cancels).toHaveLength(2);

    // Chunks arriving now belong to C.
    emitUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "three" } });
    expect(chunks).toEqual([["C", "three"]]);

    prompts[2].done.resolve({ stopReason: "end_turn" });
    expect(await c).toBe("end_turn");
    expect(completes).toEqual([
      ["A", "cancelled"],
      ["B", "cancelled"],
      ["C", "end_turn"],
    ]);
    expect(client.isPromptActive()).toBe(false);
  });

  it("a queued send without replaceActive waits for the active prompt instead of cancelling it", async () => {
    const { client, prompts, cancels, settle } = runningClient();

    const a = client.sendMessage("A", "A");
    const b = client.sendMessage("B", "B");
    await settle();
    expect(prompts.map((p) => p.text)).toEqual(["A"]);
    expect(cancels).toEqual([]);

    prompts[0].done.resolve({ stopReason: "end_turn" });
    expect(await a).toBe("end_turn");
    await settle();
    expect(prompts.map((p) => p.text)).toEqual(["A", "B"]);
    prompts[1].done.resolve({ stopReason: "end_turn" });
    expect(await b).toBe("end_turn");
  });

  it("carries rawInput and locations on tool_call_update events", () => {
    const { client, emitUpdate } = runningClient();
    const updates: unknown[] = [];
    client.on("toolCallUpdate", (_id: string, data: unknown) => updates.push(data));

    void client.sendMessage("edit", "A");
    emitUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      title: "edit",
      status: "in_progress",
      rawInput: { filePath: "/ws/src/A.java", oldString: "a", newString: "b" },
      locations: [{ path: "/ws/src/A.java" }],
    });

    expect(updates).toEqual([
      {
        name: "edit",
        callId: "t1",
        arguments: { filePath: "/ws/src/A.java", oldString: "a", newString: "b" },
        locations: ["/ws/src/A.java"],
        status: "running",
        result: undefined,
      },
    ]);
  });

  it("interruptSends cancels the active prompt and drops queued sends", async () => {
    const { client, prompts, cancels, settle } = runningClient();
    const completes: Array<[string, string]> = [];
    client.on("streamingComplete", (id: string, reason: string) => completes.push([id, reason]));

    const a = chatSend(client, "A", "A");
    const b = chatSend(client, "B", "B");
    expect(prompts.map((p) => p.text)).toEqual(["A"]);

    // Get Solution takeover: nothing freeform may survive, including B.
    await client.interruptSends();
    expect(await a).toBe("cancelled");
    expect(await b).toBe("cancelled");
    await settle();
    expect(prompts.map((p) => p.text)).toEqual(["A"]);
    expect(cancels).toHaveLength(1);
    expect(client.isPromptActive()).toBe(false);
    // Both ids get a terminal "cancelled" (order between them is not defined).
    expect([...completes].sort()).toEqual([
      ["A", "cancelled"],
      ["B", "cancelled"],
    ]);

    // The migration prompt is the next thing on the wire.
    const m = client.sendMessage("migrate", "M");
    expect(prompts.map((p) => p.text)).toEqual(["A", "migrate"]);
    prompts[1].done.resolve({ stopReason: "end_turn" });
    expect(await m).toBe("end_turn");
  });

  it("runs beforeDispatch after the previous prompt settles and before the next goes out", async () => {
    const { client, prompts, settle } = runningClient();
    const order: string[] = [];
    client.on("streamingComplete", (id: string, reason: string) =>
      order.push(`complete:${id}:${reason}`),
    );

    const a = chatSend(client, "A", "A");
    const b = client.sendMessage("B", "B", {
      replaceActive: true,
      beforeDispatch: async () => {
        order.push(`reset(prompts=${prompts.length})`);
        await new Promise((r) => setTimeout(r, 2));
        order.push("reset-done");
      },
    });

    expect(await a).toBe("cancelled");
    await settle();
    // B is not on the wire until the hook has finished.
    expect(prompts.map((p) => p.text)).toEqual(["A"]);
    await new Promise((r) => setTimeout(r, 5));
    expect(prompts.map((p) => p.text)).toEqual(["A", "B"]);
    expect(order).toEqual(["complete:A:cancelled", "reset(prompts=1)", "reset-done"]);

    prompts[1].done.resolve({ stopReason: "end_turn" });
    expect(await b).toBe("end_turn");
  });

  it("interruptSends during a pending beforeDispatch hook keeps the queued send off the wire", async () => {
    const { client, prompts, settle } = runningClient();
    const hookStarted = deferred<void>();
    const hookDone = deferred<void>();

    const a = chatSend(client, "A", "A");
    const b = client.sendMessage("B", "B", {
      replaceActive: true,
      beforeDispatch: () => {
        hookStarted.resolve();
        return hookDone.promise; // e.g. tracker.whenIdle() on A's routing
      },
    });

    // B's turn has cancelled A and is now parked in its hook.
    await hookStarted.promise;
    expect(await a).toBe("cancelled");
    expect(prompts.map((p) => p.text)).toEqual(["A"]);

    // Get Solution takes over while the hook is still pending.
    const interrupted = client.interruptSends();
    hookDone.resolve();
    await interrupted;

    expect(await b).toBe("cancelled");
    await settle();
    expect(prompts.map((p) => p.text)).toEqual(["A"]);
    expect(client.isPromptActive()).toBe(false);
  });

  it("interruptSends during an async hook on the idle path keeps the send off the wire", async () => {
    const { client, prompts, settle } = runningClient();
    const hookDone = deferred<void>();

    const a = client.sendMessage("A", "A", { beforeDispatch: () => hookDone.promise });
    expect(prompts).toHaveLength(0);

    const interrupted = client.interruptSends();
    hookDone.resolve();
    await interrupted;

    expect(await a).toBe("cancelled");
    await settle();
    expect(prompts).toHaveLength(0);
    expect(client.isPromptActive()).toBe(false);
  });

  it("cancelGeneration answers pending permission requests with 'cancelled' (ACP spec)", async () => {
    const { client } = runningClient();
    const retired: number[][] = [];
    client.on("permissionsCancelled", (ids: number[]) => retired.push(ids));
    const requested: number[] = [];
    client.on("permissionRequest", (data: { requestId: number }) => requested.push(data.requestId));

    const handle = (
      client as unknown as { handlePermissionRequest: (p: unknown) => Promise<unknown> }
    ).handlePermissionRequest;
    const params = (id: string) => ({
      sessionId: "session-1",
      toolCall: { toolCallId: id, title: "edit", rawInput: { filePath: `/ws/${id}` } },
      options: [{ optionId: "once", kind: "allow_once", name: "Allow once" }],
    });
    const first = handle.call(client, params("t1"));
    const second = handle.call(client, params("t2"));
    expect(requested).toEqual([1, 2]);

    void client.sendMessage("edit", "A");
    await client.cancelGeneration();

    expect(await first).toEqual({ outcome: { outcome: "cancelled" } });
    expect(await second).toEqual({ outcome: { outcome: "cancelled" } });
    expect(retired).toEqual([[1, 2]]);

    // Nothing pending any more: a late answer is ignored, and a second cancel
    // emits nothing.
    client.respondToRequest(1, { outcome: { outcome: "selected", optionId: "once" } });
    await client.cancelGeneration();
    expect(retired).toEqual([[1, 2]]);
  });

  it("stop() keeps a send parked in its beforeDispatch hook off the next session", async () => {
    const { client, prompts, settle } = runningClient();
    const hookDone = deferred<void>();

    const a = client.sendMessage("A", "A", { beforeDispatch: () => hookDone.promise });
    await client.stop(); // no process in the fake: state -> stopped, epoch bumped
    // Simulate a quick restart onto a fresh session before the hook resolves.
    const internals = client as unknown as { state: string; sessionId: string | null };
    internals.state = "running";
    internals.sessionId = "session-2";
    hookDone.resolve();

    expect(await a).toBe("cancelled");
    await settle();
    expect(prompts).toHaveLength(0);
  });

  it("a synchronous beforeDispatch keeps the idle fast path synchronous", () => {
    const { client, prompts } = runningClient();
    let ran = false;
    void client.sendMessage("A", "A", { beforeDispatch: () => void (ran = true) });
    expect(ran).toBe(true);
    expect(prompts.map((p) => p.text)).toEqual(["A"]);
    expect(client.isPromptActive()).toBe(true);
  });

  it("clears response state when the prompt rejects", async () => {
    const { client, prompts } = runningClient();
    const sending = client.sendMessage("boom", "A");
    prompts[0].done.reject(new Error("agent crashed"));
    await expect(sending).rejects.toThrow("agent crashed");
    expect(client.isPromptActive()).toBe(false);
  });

  it("rejects sendMessage when not running", async () => {
    const client = new AcpClient({
      workspaceDir: "/tmp/ws",
      logger: silentLogger,
      binaryName: "fake",
      binaryArgs: ["acp"],
      minimumVersion: "0.0.0",
    });
    await expect(client.sendMessage("x", "A")).rejects.toThrow("AcpClient: not running");
  });
});

describe("AcpClient workspace directory (#1389 review)", () => {
  it("decodes a file URI so a folder with spaces is a real cwd", () => {
    // A platform-native absolute path (a drive letter on Windows).
    const dir = path.join(os.tmpdir(), "My Project");
    const uri = pathToFileURL(dir).href;
    expect(uri).toContain("My%20Project");
    const client = new AcpClient({
      workspaceDir: uri,
      logger: silentLogger,
      binaryName: "fake",
      binaryArgs: ["acp"],
      minimumVersion: "0.0.0",
    });
    const config = (client as unknown as { config: { workspaceDir: string } }).config;
    expect(config.workspaceDir).toBe(dir);
  });

  it("leaves a plain filesystem path untouched", () => {
    const client = new AcpClient({
      workspaceDir: "/projects/My Project",
      logger: silentLogger,
      binaryName: "fake",
      binaryArgs: ["acp"],
      minimumVersion: "0.0.0",
    });
    const config = (client as unknown as { config: { workspaceDir: string } }).config;
    expect(config.workspaceDir).toBe("/projects/My Project");
  });
});

describe("AcpClient permission and cancellation edge cases (#1389 self-review)", () => {
  type PermissionParams = {
    sessionId: string;
    toolCall: { toolCallId: string; title: string; rawInput?: Record<string, unknown> };
    options: Array<{ optionId: string; kind: string; name: string }>;
  };
  const requestPermission = (client: AcpClient, params: PermissionParams) =>
    (
      client as unknown as { handlePermissionRequest: (p: PermissionParams) => Promise<unknown> }
    ).handlePermissionRequest(params);
  const shell = (sessionId = "session-1"): PermissionParams => ({
    sessionId,
    toolCall: { toolCallId: "sh1", title: "bash", rawInput: { command: "mvn compile" } },
    options: [
      { optionId: "once", kind: "allow_once", name: "Allow once" },
      { optionId: "reject", kind: "reject_once", name: "Reject" },
    ],
  });

  it("registers a request before announcing it, so a synchronous listener sees it pending", () => {
    const { client } = runningClient();
    const seen: boolean[] = [];
    client.on("permissionRequest", (data: { requestId: number }) =>
      seen.push(client.isPermissionPending(data.requestId)),
    );
    void requestPermission(client, shell());
    expect(seen).toEqual([true]);
  });

  it("answers a request for another session 'cancelled' without announcing it", async () => {
    const { client } = runningClient();
    let announced = 0;
    client.on("permissionRequest", () => announced++);
    expect(await requestPermission(client, shell("old-session"))).toEqual({
      outcome: { outcome: "cancelled" },
    });
    expect(announced).toBe(0);
  });

  it("answers a request that arrives while the prompt is being cancelled 'cancelled'", async () => {
    const { client, prompts } = runningClient({
      agentIgnoresCancel: true,
      promptSettleTimeoutMs: 50,
    });
    let announced = 0;
    client.on("permissionRequest", () => announced++);

    void client.sendMessage("A", "A");
    const cancelling = client.cancelGeneration();
    // The agent sent this before it processed session/cancel.
    expect(await requestPermission(client, shell())).toEqual({ outcome: { outcome: "cancelled" } });
    expect(announced).toBe(0);

    prompts[0].done.resolve({ stopReason: "cancelled" });
    await cancelling;
    // Once the cancel has settled, requests are announced normally again.
    void client.sendMessage("B", "B");
    void requestPermission(client, shell());
    expect(announced).toBe(1);
  });

  it("ignores session updates from a replaced session", () => {
    const { client } = runningClient();
    const chunks: string[] = [];
    client.on("streamingChunk", (_id: string, text: string) => chunks.push(text));
    void client.sendMessage("A", "A");
    const handle = (client as unknown as { handleSessionUpdate: (p: unknown) => void })
      .handleSessionUpdate;
    handle.call(client, {
      sessionId: "old-session",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "stale" } },
    });
    handle.call(client, {
      sessionId: "session-1",
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "fresh" } },
    });
    expect(chunks).toEqual(["fresh"]);
  });

  it("releases sendMessage as 'cancelled' when the agent never settles a cancelled prompt", async () => {
    const { client } = runningClient({ agentIgnoresCancel: true, promptSettleTimeoutMs: 20 });
    const completes: Array<[string, string]> = [];
    client.on("streamingComplete", (id: string, reason: string) => completes.push([id, reason]));

    const sending = client.sendMessage("A", "A");
    await client.interruptSends();
    expect(await sending).toBe("cancelled");
    expect(completes).toEqual([["A", "cancelled"]]);
    expect(client.isPromptActive()).toBe(false);
  });

  it("stop() releases a prompt that is still in flight", async () => {
    const { client } = runningClient({ agentIgnoresCancel: true });
    const sending = client.sendMessage("A", "A");
    await client.stop(); // no process in the fake: takes the early-return path
    expect(await sending).toBe("cancelled");
  });
});
