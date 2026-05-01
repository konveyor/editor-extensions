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
 */

import * as http from "http";
import { randomBytes } from "crypto";
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
  path: string;
  content: string;
}

export interface McpBridgeServerConfig {
  store: McpBridgeStore;
  logger: winston.Logger;
  runAnalysis?: () => Promise<void>;
  onFileChanges?: (files: FileChange[]) => Promise<void>;
}

export class McpBridgeServer {
  private server: http.Server | null = null;
  private port: number | null = null;
  private readonly config: McpBridgeServerConfig;
  private readonly logger: winston.Logger;
  private readonly bearerToken: string;

  constructor(config: McpBridgeServerConfig) {
    this.config = config;
    this.logger = config.logger;
    // Generate a random bearer token for authentication
    this.bearerToken = randomBytes(32).toString("hex");
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
   * Returns the port number.
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.logger.error(`McpBridgeServer: unhandled error: ${err}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        });
      });

      // Listen on random port (0 = OS assigns)
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
          this.logger.info(`McpBridgeServer: listening on 127.0.0.1:${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error("McpBridgeServer: failed to get server address"));
        }
      });

      this.server.on("error", (err) => {
        this.logger.error(`McpBridgeServer: server error: ${err.message}`);
        reject(err);
      });
    });
  }

  getPort(): number | null {
    return this.port;
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info("McpBridgeServer: stopped");
          this.server = null;
          this.port = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  dispose(): void {
    this.stop().catch(() => {});
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || "/", `http://127.0.0.1`);
    const pathname = url.pathname;
    const method = req.method || "GET";

    // CORS headers for local communication
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Validate bearer token authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${this.bearerToken}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    switch (pathname) {
      case "/api/health":
        res.writeHead(200);
        res.end(JSON.stringify({ status: "ok" }));
        break;

      case "/api/run-analysis":
        if (method !== "POST") {
          res.writeHead(405);
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        try {
          if (this.config.runAnalysis) {
            await this.config.runAnalysis();
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
                const fname = inc.uri.split("/").pop() || inc.uri;
                entry.files.add(fname);
              }
            }

            const violationSummary = Array.from(byViolation.entries()).map(
              ([name, { count, files }]) => ({
                violation: name,
                incidents: count,
                affectedFiles: Array.from(files).slice(0, 10),
              }),
            );

            res.writeHead(200);
            res.end(
              JSON.stringify({
                status: "analysis_complete",
                totalIncidents: incidents.length,
                totalRuleSets: ruleSetCount,
                violations: violationSummary,
              }),
            );
          } else {
            res.writeHead(503);
            res.end(JSON.stringify({ error: "Analysis not available" }));
          }
        } catch (err) {
          res.writeHead(500);
          res.end(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Analysis failed",
            }),
          );
        }
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

        res.writeHead(200);
        res.end(
          JSON.stringify({
            isAnalyzing: state.isAnalyzing,
            totalRuleSets: state.ruleSets?.length ?? 0,
            totalIncidents: incidents.length,
            fileResults,
          }),
        );
        break;
      }

      case "/api/incidents-by-file": {
        const fileParam = url.searchParams.get("file");
        if (!fileParam) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Missing 'file' query parameter" }));
          return;
        }
        const state = this.config.store.getState();
        const filtered = state.enhancedIncidents.filter(
          (incident) =>
            incident.uri === fileParam ||
            incident.uri.endsWith(fileParam) ||
            fileParam.endsWith(incident.uri),
        );
        res.writeHead(200);
        res.end(JSON.stringify({ incidents: filtered }));
        break;
      }

      case "/api/apply-file-changes": {
        if (method !== "POST") {
          res.writeHead(405);
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }
        const body = await this.readBody(req);
        try {
          const changes = JSON.parse(body);
          if (
            !changes.files ||
            !Array.isArray(changes.files) ||
            !changes.files.every(
              (f: unknown) =>
                typeof (f as FileChange).path === "string" &&
                typeof (f as FileChange).content === "string",
            )
          ) {
            res.writeHead(400);
            res.end(
              JSON.stringify({
                error:
                  "Invalid file change payload: expected { files: Array<{ path: string, content: string }> }",
              }),
            );
            return;
          }
          const files = changes.files as FileChange[];
          this.logger.info(`McpBridgeServer: received file changes for ${files.length} file(s)`);

          if (this.config.onFileChanges && files.length > 0) {
            await this.config.onFileChanges(files);
          }

          res.writeHead(200);
          res.end(JSON.stringify({ status: "changes_received", count: files.length }));
        } catch (err) {
          this.logger.error("McpBridgeServer: error processing file changes", err);
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
        }
        break;
      }

      default:
        res.writeHead(404);
        res.end(JSON.stringify({ error: "Not found" }));
    }
  }

  private readBody(req: http.IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          reject(new Error("Request body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }
}
