import expect from "expect";
import { WebSocketServer, WebSocket as WsSocket } from "ws";
import type { AddressInfo } from "net";
import { HubAcpViewer, describeClose, type WebSocketLike } from "../hubAcpViewer";

/**
 * A stand-in for the harness tee behind the Hub: answers initialize and
 * session/new, then lets the test push the run's traffic.
 */
async function fakeTee() {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => server.once("listening", () => r()));
  const received: any[] = [];
  let socket: WsSocket | undefined;
  const connected = new Promise<void>((resolve) => {
    server.on("connection", (ws) => {
      socket = ws;
      ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw));
        received.push(msg);
        if (msg.method === "initialize") {
          ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } }));
        } else if (msg.method === "session/new") {
          ws.send(
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "viewer-1" } }),
          );
        }
      });
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `ws://127.0.0.1:${port}/hub/agentic/agentruns/r/acp?nonce=n`,
    received,
    connected,
    send: (msg: unknown) => socket!.send(JSON.stringify(msg)),
    closeSocket: () => socket!.close(1000, "run ended"),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const wsFactory = (url: string) => new WsSocket(url) as unknown as WebSocketLike;
const nextTick = () => new Promise((r) => setTimeout(r, 30));

describe("HubAcpViewer", () => {
  let tee: Awaited<ReturnType<typeof fakeTee>>;
  let viewer: HubAcpViewer | undefined;

  beforeEach(async () => {
    tee = await fakeTee();
  });
  afterEach(async () => {
    viewer?.close();
    await tee.close();
  });

  it("initializes and opens its own silent session", async () => {
    viewer = await HubAcpViewer.connect(tee.url, wsFactory);
    expect(tee.received.map((m) => m.method)).toEqual(["initialize", "session/new"]);
    expect(tee.received[1].params).toEqual({ cwd: "/workspace", mcpServers: [] });
  });

  it("emits the run's updates and drops its own session's", async () => {
    viewer = await HubAcpViewer.connect(tee.url, wsFactory);
    const updates: Array<[string, string]> = [];
    viewer.on("update", (u, sid) => updates.push([u.sessionUpdate, sid]));
    tee.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "viewer-1", update: { sessionUpdate: "agent_message_chunk" } },
    });
    tee.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "run-7", update: { sessionUpdate: "tool_call" } },
    });
    await nextTick();
    expect(updates).toEqual([["tool_call", "run-7"]]);
  });

  it("answers a permission ask under the tee's id", async () => {
    viewer = await HubAcpViewer.connect(tee.url, wsFactory);
    const asks: any[] = [];
    viewer.on("permission", (a) => asks.push(a));
    tee.send({
      jsonrpc: "2.0",
      id: "kperm-1",
      method: "session/request_permission",
      params: {
        sessionId: "run-7",
        toolCall: { toolCallId: "t1", title: "edit" },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
      },
    });
    await nextTick();
    expect(asks).toHaveLength(1);
    expect(asks[0].askId).toBe("kperm-1");
    viewer.respondPermission("kperm-1", { outcome: { outcome: "selected", optionId: "allow" } });
    viewer.respondPermission("kperm-1", { outcome: { outcome: "cancelled" } }); // second answer ignored
    await nextTick();
    const answers = tee.received.filter((m) => m.id === "kperm-1");
    expect(answers).toEqual([
      {
        jsonrpc: "2.0",
        id: "kperm-1",
        result: { outcome: { outcome: "selected", optionId: "allow" } },
      },
    ]);
  });

  it("closes an ask concluded elsewhere without answering it", async () => {
    viewer = await HubAcpViewer.connect(tee.url, wsFactory);
    const resolved: unknown[] = [];
    viewer.on("askResolved", (id) => resolved.push(id));
    tee.send({
      jsonrpc: "2.0",
      id: "kask-3",
      method: "elicitation/create",
      params: {
        message: "Which version?",
        requestedSchema: { properties: { answer: { type: "string" } } },
      },
    });
    await nextTick();
    // Another viewer answered: the tee broadcasts the response.
    tee.send({
      jsonrpc: "2.0",
      id: "kask-3",
      result: { action: "accept", content: { answer: "17" } },
    });
    await nextTick();
    expect(resolved).toEqual(["kask-3"]);
    viewer.respondElicitation("kask-3", { action: "decline" });
    await nextTick();
    expect(tee.received.filter((m) => m.id === "kask-3")).toEqual([]);
  });

  it("refuses requests a viewer cannot serve", async () => {
    viewer = await HubAcpViewer.connect(tee.url, wsFactory);
    tee.send({ jsonrpc: "2.0", id: 99, method: "fs/read_text_file", params: { path: "/etc/x" } });
    await nextTick();
    const reply = tee.received.find((m) => m.id === 99);
    expect(reply.error.code).toBe(-32601);
  });

  it("reports the run's socket closing", async () => {
    viewer = await HubAcpViewer.connect(tee.url, wsFactory);
    const closed = new Promise<number>((r) => viewer!.once("close", (code: number) => r(code)));
    tee.closeSocket();
    expect(await closed).toBe(1000);
    expect(viewer.isClosed).toBe(true);
  });

  it("fails to connect when nothing is listening", async () => {
    await tee.close();
    tee = await fakeTee();
    const url = tee.url;
    await tee.close();
    await expect(HubAcpViewer.connect(url, wsFactory)).rejects.toThrow(/ACP connection/);
    tee = await fakeTee(); // for afterEach
  });
});

describe("describeClose", () => {
  it("explains the Hub's 4404 for a run with no endpoint", () => {
    expect(describeClose(4404)).toMatch(/may have finished or not started/);
    expect(describeClose(1006)).toBe("ACP connection closed (1006)");
    expect(describeClose(1000, "run ended")).toBe("ACP connection closed (1000 run ended)");
  });
});
