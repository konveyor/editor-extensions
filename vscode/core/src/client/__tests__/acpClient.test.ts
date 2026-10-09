import expect from "expect";
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
function runningClient() {
  const client = new AcpClient({
    workspaceDir: "/tmp/ws",
    logger: silentLogger,
    binaryName: "fake",
    binaryArgs: ["acp"],
    minimumVersion: "0.0.0",
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
      setTimeout(() => current?.done.resolve({ stopReason: "cancelled" }), 5);
    },
  };

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

  return { client, prompts, cancels, emitUpdate };
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
