import expect from "expect";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import winston from "winston";
import type { EnhancedIncident } from "@editor-extensions/shared";

import {
  FileChange,
  MAX_BODY_BYTES,
  McpBridgeServer,
  McpBridgeServerConfig,
  incidentMatchesFile,
  resolveMcpServerEntry,
  resolveWithinRoots,
} from "../mcpBridgeServer";

const silentLogger = winston.createLogger({ silent: true, transports: [] });

const WORKSPACE = path.join(os.tmpdir(), "konveyor-bridge-test-ws");
const OTHER_WORKSPACE = path.join(os.tmpdir(), "konveyor-bridge-test-ws-2");

function incident(overrides: Partial<EnhancedIncident>): EnhancedIncident {
  return {
    violationId: "v1",
    uri: "file:///ws/src/Foo.java",
    message: "msg",
    ...overrides,
  };
}

interface Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json(): unknown;
}

function request(
  port: number,
  opts: { method?: string; path: string; token?: string | null; body?: string | Buffer },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers: http.OutgoingHttpHeaders = {};
    if (opts.token !== null) {
      headers.authorization = `Bearer ${opts.token ?? ""}`;
    }
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(opts.body);
    }
    const req = http.request(
      { host: "127.0.0.1", port, method: opts.method ?? "GET", path: opts.path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            json: () => JSON.parse(body),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) {
      req.write(opts.body);
    }
    req.end();
  });
}

function makeServer(overrides: Partial<McpBridgeServerConfig> = {}): McpBridgeServer {
  return new McpBridgeServer({
    store: { getState: () => ({ enhancedIncidents: [], isAnalyzing: false }) },
    logger: silentLogger,
    workspaceRoots: [WORKSPACE],
    ...overrides,
  });
}

describe("resolveWithinRoots", () => {
  const roots = [WORKSPACE, OTHER_WORKSPACE];

  it("accepts a relative path inside the first root", () => {
    expect(resolveWithinRoots("src/Foo.java", roots)).toBe(path.join(WORKSPACE, "src", "Foo.java"));
  });

  it("accepts an absolute path inside any root", () => {
    const target = path.join(OTHER_WORKSPACE, "pom.xml");
    expect(resolveWithinRoots(target, roots)).toBe(target);
  });

  it("rejects traversal out of the workspace", () => {
    expect(resolveWithinRoots("../../etc/passwd", roots)).toBeNull();
    expect(resolveWithinRoots("src/../../outside.txt", roots)).toBeNull();
  });

  it("rejects absolute paths outside every root", () => {
    expect(resolveWithinRoots(path.join(os.tmpdir(), "elsewhere.txt"), roots)).toBeNull();
    expect(resolveWithinRoots("/etc/passwd", roots)).toBeNull();
  });

  it("rejects a sibling directory that shares the root as a prefix", () => {
    expect(resolveWithinRoots(`${WORKSPACE}-evil/x.txt`, roots)).toBeNull();
  });

  it("rejects the root itself, empty input and NUL bytes", () => {
    expect(resolveWithinRoots(WORKSPACE, roots)).toBeNull();
    expect(resolveWithinRoots(".", roots)).toBeNull();
    expect(resolveWithinRoots("", roots)).toBeNull();
    expect(resolveWithinRoots("src/Foo.java\0.txt", roots)).toBeNull();
  });

  it("returns null when there are no roots", () => {
    expect(resolveWithinRoots("src/Foo.java", [])).toBeNull();
  });
});

describe("incidentMatchesFile", () => {
  it("matches exact uris", () => {
    expect(incidentMatchesFile("/ws/src/Foo.java", "/ws/src/Foo.java")).toBe(true);
  });

  it("matches a path-segment suffix in either direction", () => {
    expect(incidentMatchesFile("file:///ws/src/Foo.java", "src/Foo.java")).toBe(true);
    expect(incidentMatchesFile("src/Foo.java", "/ws/src/Foo.java")).toBe(true);
    expect(incidentMatchesFile("C:\\ws\\src\\Foo.java", "Foo.java")).toBe(true);
  });

  it("does not match a partial file name", () => {
    expect(incidentMatchesFile("/ws/src/MyFoo.java", "Foo.java")).toBe(false);
    expect(incidentMatchesFile("Foo.java", "/ws/src/MyFoo.java")).toBe(false);
  });

  it("returns false for missing uris", () => {
    expect(incidentMatchesFile(undefined, "Foo.java")).toBe(false);
    expect(incidentMatchesFile("", "Foo.java")).toBe(false);
  });
});

describe("McpBridgeServer", () => {
  let server: McpBridgeServer;
  let port: number;
  let token: string;

  afterEach(async () => {
    await server?.stop();
  });

  describe("construction and lifecycle", () => {
    it("requires at least one workspace root", () => {
      expect(() => makeServer({ workspaceRoots: [] })).toThrow(/workspaceRoots/);
    });

    it("starts on a loopback port and reports it", async () => {
      server = makeServer();
      port = await server.start();
      expect(port).toBeGreaterThan(0);
      expect(server.getPort()).toBe(port);
      expect(server.getBearerToken()).toMatch(/^[0-9a-f]{64}$/);
    });

    it("rejects a second start while running", async () => {
      server = makeServer();
      await server.start();
      await expect(server.start()).rejects.toThrow(/already started/);
    });

    it("stop() resolves while a request is still in flight", async () => {
      // Node >= 19 closes idle keep-alive sockets in server.close(), but a
      // socket with an unanswered request keeps close() pending until the
      // handler finishes. A long analysis would wedge extension teardown.
      let releaseAnalysis: () => void = () => {};
      let analysisStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        analysisStarted = resolve;
      });
      server = makeServer({
        runAnalysis: () =>
          new Promise<void>((resolve) => {
            releaseAnalysis = resolve;
            analysisStarted();
          }),
      });
      port = await server.start();
      token = server.getBearerToken();

      const inflight = request(port, { method: "POST", path: "/api/run-analysis", token }).catch(
        (err: Error) => err,
      );
      await started;

      const stopped = await Promise.race([
        server.stop().then(() => "stopped"),
        new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 2000)),
      ]);
      releaseAnalysis();
      expect(stopped).toBe("stopped");
      expect(server.getPort()).toBeNull();
      expect(await inflight).toBeInstanceOf(Error);
    });

    it("stop() is idempotent and allows a restart", async () => {
      server = makeServer();
      await server.start();
      await server.stop();
      await server.stop();
      const newPort = await server.start();
      expect(newPort).toBeGreaterThan(0);
    });
  });

  describe("authentication", () => {
    beforeEach(async () => {
      server = makeServer();
      port = await server.start();
      token = server.getBearerToken();
    });

    it("rejects requests without a token", async () => {
      const res = await request(port, { path: "/api/health", token: null });
      expect(res.status).toBe(401);
      expect(res.json()).toEqual({ error: "Unauthorized" });
    });

    it("rejects wrong tokens of the same length and of a different length", async () => {
      const wrongSameLength = token.replace(/./g, (c) => (c === "a" ? "b" : "a"));
      expect((await request(port, { path: "/api/health", token: wrongSameLength })).status).toBe(
        401,
      );
      expect((await request(port, { path: "/api/health", token: token.slice(1) })).status).toBe(
        401,
      );
      expect((await request(port, { path: "/api/health", token: `${token}0` })).status).toBe(401);
    });

    it("rejects a non-bearer scheme", async () => {
      const res = await new Promise<Response>((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: "/api/health", headers: { authorization: token } },
          (r) => {
            r.resume();
            r.on("end", () =>
              resolve({
                status: r.statusCode ?? 0,
                headers: r.headers,
                body: "",
                json: () => ({}),
              }),
            );
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(res.status).toBe(401);
    });

    it("accepts the right token and answers health", async () => {
      const res = await request(port, { path: "/api/health", token });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/json");
      expect(res.json()).toEqual({ status: "ok" });
    });

    it("does not emit CORS headers", async () => {
      const res = await request(port, { path: "/api/health", token });
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("treats OPTIONS like any other unauthenticated request", async () => {
      const res = await request(port, { method: "OPTIONS", path: "/api/health", token: null });
      expect(res.status).toBe(401);
    });
  });

  describe("routing", () => {
    beforeEach(async () => {
      server = makeServer();
      port = await server.start();
      token = server.getBearerToken();
    });

    it("returns 404 for unknown paths", async () => {
      const res = await request(port, { path: "/api/nope", token });
      expect(res.status).toBe(404);
    });

    it("returns 405 for GET on POST-only routes", async () => {
      expect((await request(port, { path: "/api/run-analysis", token })).status).toBe(405);
      expect((await request(port, { path: "/api/apply-file-changes", token })).status).toBe(405);
    });
  });

  describe("/api/run-analysis", () => {
    const incidents = [
      incident({ uri: "file:///ws/src/Foo.java", violation_name: "v-a" }),
      incident({ uri: "file:///ws/src/Bar.java", violation_name: "v-a" }),
      incident({ uri: "C:\\ws\\src\\Baz.java", violation_name: "v-b" }),
    ];

    it("returns 503 when no analysis runner is configured", async () => {
      server = makeServer();
      port = await server.start();
      token = server.getBearerToken();
      const res = await request(port, { method: "POST", path: "/api/run-analysis", token });
      expect(res.status).toBe(503);
    });

    it("runs analysis and summarizes incidents by violation", async () => {
      let ran = 0;
      server = makeServer({
        runAnalysis: async () => {
          ran++;
        },
        store: {
          getState: () => ({
            enhancedIncidents: incidents,
            ruleSets: [{ name: "rs" } as never],
            isAnalyzing: false,
          }),
        },
      });
      port = await server.start();
      token = server.getBearerToken();

      const res = await request(port, { method: "POST", path: "/api/run-analysis", token });
      expect(res.status).toBe(200);
      expect(ran).toBe(1);
      expect(res.json()).toEqual({
        status: "analysis_complete",
        totalIncidents: 3,
        totalRuleSets: 1,
        violations: [
          { violation: "v-a", incidents: 2, affectedFiles: ["Foo.java", "Bar.java"] },
          { violation: "v-b", incidents: 1, affectedFiles: ["Baz.java"] },
        ],
      });
    });

    it("returns 500 with the error message when analysis throws", async () => {
      server = makeServer({
        runAnalysis: async () => {
          throw new Error("analyzer exploded");
        },
      });
      port = await server.start();
      token = server.getBearerToken();
      const res = await request(port, { method: "POST", path: "/api/run-analysis", token });
      expect(res.status).toBe(500);
      expect(res.json()).toEqual({ error: "analyzer exploded" });
    });
  });

  describe("/api/analysis-results", () => {
    it("groups incidents by file", async () => {
      server = makeServer({
        store: {
          getState: () => ({
            enhancedIncidents: [
              incident({ uri: "/ws/A.java", violation_name: "v1", lineNumber: 3, message: "m1" }),
              incident({ uri: "/ws/A.java", violation_name: "v2", message: "m2" }),
              incident({ uri: "/ws/B.java", violation_name: "v1", lineNumber: 0, message: "m3" }),
            ],
            ruleSets: [],
            isAnalyzing: true,
          }),
        },
      });
      port = await server.start();
      token = server.getBearerToken();

      const res = await request(port, { path: "/api/analysis-results", token });
      expect(res.status).toBe(200);
      expect(res.json()).toEqual({
        isAnalyzing: true,
        totalRuleSets: 0,
        totalIncidents: 3,
        fileResults: [
          {
            file: "/ws/A.java",
            incidents: [
              { violation: "v1", line: 3, message: "m1" },
              { violation: "v2", message: "m2" },
            ],
          },
          { file: "/ws/B.java", incidents: [{ violation: "v1", line: 0, message: "m3" }] },
        ],
      });
    });
  });

  describe("/api/incidents-by-file", () => {
    beforeEach(async () => {
      server = makeServer({
        store: {
          getState: () => ({
            enhancedIncidents: [
              incident({ uri: "file:///ws/src/Foo.java", violationId: "foo" }),
              incident({ uri: "file:///ws/src/MyFoo.java", violationId: "myfoo" }),
              incident({ uri: undefined as unknown as string, violationId: "no-uri" }),
            ],
            isAnalyzing: false,
          }),
        },
      });
      port = await server.start();
      token = server.getBearerToken();
    });

    it("requires the file parameter", async () => {
      const res = await request(port, { path: "/api/incidents-by-file", token });
      expect(res.status).toBe(400);
    });

    it("matches on path segment boundaries and skips incidents without a uri", async () => {
      const res = await request(port, { path: "/api/incidents-by-file?file=Foo.java", token });
      expect(res.status).toBe(200);
      const ids = (res.json() as { incidents: EnhancedIncident[] }).incidents.map(
        (i) => i.violationId,
      );
      expect(ids).toEqual(["foo"]);
    });

    it("returns an empty list when nothing matches", async () => {
      const res = await request(port, { path: "/api/incidents-by-file?file=Nope.java", token });
      expect(res.json()).toEqual({ incidents: [] });
    });
  });

  describe("/api/apply-file-changes", () => {
    let received: FileChange[][];

    beforeEach(async () => {
      received = [];
      server = makeServer({
        workspaceRoots: [WORKSPACE, OTHER_WORKSPACE],
        onFileChanges: async (files) => {
          received.push(files);
        },
      });
      port = await server.start();
      token = server.getBearerToken();
    });

    const post = (body: string | Buffer) =>
      request(port, { method: "POST", path: "/api/apply-file-changes", token, body });

    it("rejects invalid JSON", async () => {
      const res = await post("{not json");
      expect(res.status).toBe(400);
      expect(res.json()).toEqual({ error: "Invalid JSON body" });
      expect(received).toEqual([]);
    });

    it("rejects payloads that are not { files: [...] }", async () => {
      for (const body of [
        "null",
        "{}",
        '{"files":"x"}',
        '{"files":[{"path":"a"}]}',
        '{"files":[{"path":1,"content":"x"}]}',
        '{"files":[null]}',
      ]) {
        const res = await post(body);
        expect(res.status).toBe(400);
      }
      expect(received).toEqual([]);
    });

    it("applies changes and resolves paths to absolute workspace paths", async () => {
      const res = await post(
        JSON.stringify({
          files: [
            { path: "src/Foo.java", content: "a" },
            { path: path.join(OTHER_WORKSPACE, "pom.xml"), content: "b" },
          ],
        }),
      );
      expect(res.status).toBe(200);
      expect(res.json()).toEqual({ status: "changes_received", count: 2 });
      expect(received).toEqual([
        [
          { path: path.join(WORKSPACE, "src", "Foo.java"), content: "a" },
          { path: path.join(OTHER_WORKSPACE, "pom.xml"), content: "b" },
        ],
      ]);
    });

    it("rejects the whole batch with 403 when any path escapes the workspace", async () => {
      const res = await post(
        JSON.stringify({
          files: [
            { path: "src/Foo.java", content: "a" },
            { path: "../../etc/passwd", content: "pwned" },
          ],
        }),
      );
      expect(res.status).toBe(403);
      expect((res.json() as { error: string }).error).toMatch(/outside the workspace/);
      expect(received).toEqual([]);
    });

    it("rejects absolute paths outside the workspace", async () => {
      const res = await post(JSON.stringify({ files: [{ path: "/etc/passwd", content: "x" }] }));
      expect(res.status).toBe(403);
      expect(received).toEqual([]);
    });

    it("does not call the handler for an empty batch", async () => {
      const res = await post(JSON.stringify({ files: [] }));
      expect(res.status).toBe(200);
      expect(res.json()).toEqual({ status: "changes_received", count: 0 });
      expect(received).toEqual([]);
    });

    it("returns 500 when the change handler fails", async () => {
      await server.stop();
      server = makeServer({
        onFileChanges: async () => {
          throw new Error("disk full");
        },
      });
      port = await server.start();
      token = server.getBearerToken();
      const res = await post(JSON.stringify({ files: [{ path: "a.txt", content: "x" }] }));
      expect(res.status).toBe(500);
      expect(res.json()).toEqual({ error: "disk full" });
    });

    it("returns 413 for oversized bodies", async () => {
      const big = Buffer.alloc(MAX_BODY_BYTES + 1024, "a");
      const res = await post(big);
      expect(res.status).toBe(413);
      expect((res.json() as { error: string }).error).toMatch(/exceeds/);
      expect(received).toEqual([]);
    });
  });
});

describe("resolveMcpServerEntry", () => {
  const extensionRoot = path.join(os.tmpdir(), "konveyor-bridge-test-ext");
  const context = (mcpServer?: string) => ({
    asAbsolutePath: (p: string) => path.resolve(extensionRoot, p),
    extension: {
      packageJSON: {
        includedAssetPaths: mcpServer ? { mcpServer } : ({} as Record<string, string>),
      },
    },
  });

  beforeEach(() => {
    fs.rmSync(extensionRoot, { recursive: true, force: true });
    fs.mkdirSync(path.join(extensionRoot, "assets", "mcp-server"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(extensionRoot, { recursive: true, force: true });
  });

  it("returns the bundled entrypoint when it exists", () => {
    const entry = path.join(extensionRoot, "assets", "mcp-server", "index.js");
    fs.writeFileSync(entry, "");
    expect(resolveMcpServerEntry(context("./assets/mcp-server"))).toBe(entry);
  });

  it("returns null when the bundle is missing", () => {
    expect(resolveMcpServerEntry(context("./assets/mcp-server"))).toBeNull();
  });

  it("returns null when package.json declares no mcpServer asset", () => {
    expect(resolveMcpServerEntry(context())).toBeNull();
  });
});
