/**
 * MCP Bridge Server: A minimal HTTP server on localhost that the Konveyor
 * MCP server calls back into to access extension state and trigger actions.
 *
 * Routes:
 * - GET  /api/health             → Health check
 * - POST /api/run-analysis       → Trigger analysis via analyzer client
 * - GET  /api/analysis-results   → Get current ruleSets + enhancedIncidents
 * - GET  /api/incidents-by-file  → Get filtered incidents for a specific file
 * - POST /api/apply-file-changes → Apply file modifications to workspace
 *
 * Every request must carry `Authorization: Bearer <token>` where the token is
 * the per-instance secret returned by `getBearerToken()`. The server only
 * binds to 127.0.0.1 and does not emit CORS headers: it is a process-to-process
 * channel, not a browser API.
 */

import * as http from "http";
import * as path from "path";
import { randomBytes, timingSafeEqual } from "crypto";
import winston from "winston";
import type { EnhancedIncident, RuleSet } from "@editor-extensions/shared";

/**
 * Minimal store interface for the MCP bridge.
 * The full ExtensionStore is provided by the agent feature (PR #1389).
 */
export interface McpBridgeStore {
  getState(): {
    enhancedIncidents: EnhancedIncident[];
    ruleSets?: RuleSet[];
    isAnalyzing: boolean;
  };
}

export interface FileChange {
  /** Absolute, normalized path inside one of the configured workspace roots. */
  path: string;
  content: string;
}

export interface McpBridgeServerConfig {
  store: McpBridgeStore;
  logger: winston.Logger;
  /**
   * Absolute paths of the workspace folders the agent is allowed to write to.
   * File change paths are resolved against the first root when relative and
   * rejected (403) when they land outside every root. Must be non-empty.
   */
  workspaceRoots: string[];
  runAnalysis?: () => Promise<void>;
  onFileChanges?: (files: FileChange[]) => Promise<void>;
}

/** Maximum accepted request body, in bytes. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

class PayloadTooLargeError extends Error {
  constructor(limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Resolve `candidate` against `roots` and return the absolute path if it is
 * strictly inside one of them, otherwise `null`.
 *
 * Relative candidates are resolved against the first root. The root itself
 * is not a valid target (it is a directory, not a file).
 */
export function resolveWithinRoots(candidate: string, roots: string[]): string | null {
  if (roots.length === 0 || typeof candidate !== "string" || candidate.length === 0) {
    return null;
  }
  // Reject NUL bytes outright; they truncate paths in libc and can defeat
  // string-level containment checks.
  if (candidate.includes("\0")) {
    return null;
  }
  const resolved = path.resolve(roots[0], candidate);
  for (const root of roots) {
    const normalizedRoot = path.resolve(root);
    const rel = path.relative(normalizedRoot, resolved);
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      return resolved;
    }
  }
  return null;
}

/**
 * Whether an incident URI refers to `fileParam`. Exact matches win; otherwise
 * one side must be a path-segment suffix of the other, so `Foo.java` matches
 * `/src/Foo.java` but not `/src/MyFoo.java`.
 */
export function incidentMatchesFile(uri: string | undefined, fileParam: string): boolean {
  if (!uri) {
    return false;
  }
  if (uri === fileParam) {
    return true;
  }
  return isPathSuffix(uri, fileParam) || isPathSuffix(fileParam, uri);
}

function isPathSuffix(full: string, suffix: string): boolean {
  if (suffix.length === 0 || full.length <= suffix.length || !full.endsWith(suffix)) {
    return false;
  }
  const boundary = full.charAt(full.length - suffix.length - 1);
  return boundary === "/" || boundary === "\\";
}

export class McpBridgeServer {
  private server: http.Server | null = null;
  private port: number | null = null;
  private readonly config: McpBridgeServerConfig;
  private readonly logger: winston.Logger;
  private readonly bearerToken: string;
  private readonly bearerTokenBuffer: Buffer;

  constructor(config: McpBridgeServerConfig) {
    if (!Array.isArray(config.workspaceRoots) || config.workspaceRoots.length === 0) {
      throw new Error("McpBridgeServer: workspaceRoots must contain at least one path");
    }
    this.config = config;
    this.logger = config.logger;
    // Generate a random bearer token for authentication
    this.bearerToken = randomBytes(32).toString("hex");
    this.bearerTokenBuffer = Buffer.from(this.bearerToken, "utf8");
  }

  /**
   * Get the bearer token for authenticating requests to this server.
   * Pass this to the MCP server via environment variable.
   */
  getBearerToken(): string {
    return this.bearerToken;
  }

  /**
   * Start the bridge server on a random available port.
   * Returns the port number. Rejects if the server is already running.
   */
  async start(): Promise<number> {
    if (this.server) {
      return Promise.reject(new Error("McpBridgeServer: already started"));
    }
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.logger.error(`McpBridgeServer: unhandled error: ${err}`);
          this.sendError(res, 500, "Internal server error");
        });
      });
      this.server = server;

      const onListenError = (err: Error) => {
        this.logger.error(`McpBridgeServer: failed to listen: ${err.message}`);
        this.server = null;
        reject(err);
      };
      server.once("error", onListenError);

      // Listen on random port (0 = OS assigns)
      server.listen(0, "127.0.0.1", () => {
        server.off("error", onListenError);
        server.on("error", (err) => {
          this.logger.error(`McpBridgeServer: server error: ${err.message}`);
        });
        const addr = server.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
          this.logger.info(`McpBridgeServer: listening on 127.0.0.1:${this.port}`);
          resolve(this.port);
        } else {
          server.close();
          this.server = null;
          reject(new Error("McpBridgeServer: failed to get server address"));
        }
      });
    });
  }

  getPort(): number | null {
    return this.port;
  }

  /**
   * Stop listening and tear down every open connection. `server.close()` alone
   * waits for keep-alive sockets to go idle, which the MCP server's fetch
   * client never does on its own, so we force them closed.
   */
  async stop(): Promise<void> {
    const server = this.server;
    if (!server) {
      return;
    }
    this.server = null;
    this.port = null;
    await new Promise<void>((resolve) => {
      server.close(() => {
        this.logger.info("McpBridgeServer: stopped");
        resolve();
      });
      server.closeAllConnections();
    });
  }

  dispose(): void {
    this.stop().catch(() => {});
  }

  private sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
    if (res.headersSent) {
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  }

  private sendError(res: http.ServerResponse, status: number, message: string): void {
    this.sendJson(res, status, { error: message });
  }

  private isAuthorized(req: http.IncomingMessage): boolean {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      return false;
    }
    const presented = Buffer.from(authHeader.slice("Bearer ".length), "utf8");
    if (presented.length !== this.bearerTokenBuffer.length) {
      return false;
    }
    return timingSafeEqual(presented, this.bearerTokenBuffer);
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://127.0.0.1`);
    const pathname = url.pathname;
    const method = req.method || "GET";

    if (!this.isAuthorized(req)) {
      this.sendError(res, 401, "Unauthorized");
      return;
    }

    switch (pathname) {
      case "/api/health":
        this.sendJson(res, 200, { status: "ok" });
        break;

      case "/api/run-analysis":
        if (method !== "POST") {
          this.sendError(res, 405, "Method not allowed");
          return;
        }
        if (!this.config.runAnalysis) {
          this.sendError(res, 503, "Analysis not available");
          return;
        }
        try {
          await this.config.runAnalysis();
        } catch (err) {
          this.sendError(res, 500, err instanceof Error ? err.message : "Analysis failed");
          return;
        }
        this.sendJson(res, 200, this.buildAnalysisSummary());
        break;

      case "/api/analysis-results": {
        const state = this.config.store.getState();
        const incidents = state.enhancedIncidents ?? [];

        const byFile = new Map<
          string,
          Array<{ violation: string; line?: number; message: string }>
        >();
        for (const inc of incidents) {
          const filePath = inc.uri || "unknown";
          let list = byFile.get(filePath);
          if (!list) {
            list = [];
            byFile.set(filePath, list);
          }
          list.push({
            violation: inc.violation_name || "unknown",
            line: inc.lineNumber,
            message: inc.message || "",
          });
        }

        const fileResults = Array.from(byFile.entries()).map(([file, items]) => ({
          file,
          incidents: items,
        }));

        this.sendJson(res, 200, {
          isAnalyzing: state.isAnalyzing,
          totalRuleSets: state.ruleSets?.length ?? 0,
          totalIncidents: incidents.length,
          fileResults,
        });
        break;
      }

      case "/api/incidents-by-file": {
        const fileParam = url.searchParams.get("file");
        if (!fileParam) {
          this.sendError(res, 400, "Missing 'file' query parameter");
          return;
        }
        const state = this.config.store.getState();
        const filtered = (state.enhancedIncidents ?? []).filter((incident) =>
          incidentMatchesFile(incident.uri, fileParam),
        );
        this.sendJson(res, 200, { incidents: filtered });
        break;
      }

      case "/api/apply-file-changes": {
        if (method !== "POST") {
          this.sendError(res, 405, "Method not allowed");
          return;
        }
        let body: string;
        try {
          body = await this.readBody(req);
        } catch (err) {
          if (err instanceof PayloadTooLargeError) {
            this.sendError(res, 413, err.message);
          } else {
            this.sendError(res, 400, "Failed to read request body");
          }
          return;
        }

        let changes: unknown;
        try {
          changes = JSON.parse(body);
        } catch {
          this.sendError(res, 400, "Invalid JSON body");
          return;
        }

        const rawFiles = (changes as { files?: unknown } | null)?.files;
        if (
          !Array.isArray(rawFiles) ||
          !rawFiles.every(
            (f: unknown) =>
              typeof (f as FileChange)?.path === "string" &&
              typeof (f as FileChange)?.content === "string",
          )
        ) {
          this.sendError(
            res,
            400,
            "Invalid file change payload: expected { files: Array<{ path: string, content: string }> }",
          );
          return;
        }

        const files: FileChange[] = [];
        for (const f of rawFiles as FileChange[]) {
          const resolved = resolveWithinRoots(f.path, this.config.workspaceRoots);
          if (!resolved) {
            this.logger.warn(`McpBridgeServer: rejected file change outside workspace: ${f.path}`);
            this.sendError(res, 403, `Path is outside the workspace: ${f.path}`);
            return;
          }
          files.push({ path: resolved, content: f.content });
        }

        this.logger.info(`McpBridgeServer: received file changes for ${files.length} file(s)`);
        try {
          if (this.config.onFileChanges && files.length > 0) {
            await this.config.onFileChanges(files);
          }
        } catch (err) {
          this.logger.error("McpBridgeServer: error applying file changes", err);
          this.sendError(res, 500, err instanceof Error ? err.message : "Failed to apply changes");
          return;
        }

        this.sendJson(res, 200, { status: "changes_received", count: files.length });
        break;
      }

      default:
        this.sendError(res, 404, "Not found");
    }
  }

  private buildAnalysisSummary() {
    const data = this.config.store.getState();
    const incidents = data.enhancedIncidents ?? [];
    const ruleSetCount = data.ruleSets?.length ?? 0;

    const byViolation = new Map<string, { count: number; files: Set<string> }>();
    for (const inc of incidents) {
      const key = inc.violation_name || inc.message || "unknown";
      let entry = byViolation.get(key);
      if (!entry) {
        entry = { count: 0, files: new Set() };
        byViolation.set(key, entry);
      }
      entry.count++;
      if (inc.uri) {
        const fname = inc.uri.split(/[\\/]/).pop() || inc.uri;
        entry.files.add(fname);
      }
    }

    const violationSummary = Array.from(byViolation.entries()).map(([name, { count, files }]) => ({
      violation: name,
      incidents: count,
      affectedFiles: Array.from(files).slice(0, 10),
    }));

    return {
      status: "analysis_complete",
      totalIncidents: incidents.length,
      totalRuleSets: ruleSetCount,
      violations: violationSummary,
    };
  }

  private readBody(req: http.IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let overflowed = false;
      req.on("data", (chunk: Buffer) => {
        if (overflowed) {
          return;
        }
        total += chunk.length;
        if (total > maxBytes) {
          // Stop buffering and let the route answer 413. Node drains the rest
          // of the request once the response is finished.
          overflowed = true;
          chunks.length = 0;
          reject(new PayloadTooLargeError(maxBytes));
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (!overflowed) {
          resolve(Buffer.concat(chunks).toString("utf8"));
        }
      });
      req.on("error", reject);
    });
  }
}
