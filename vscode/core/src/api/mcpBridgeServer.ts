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
import winston from "winston";
import { type ExtensionStore } from "../store/extensionStore";

export interface McpBridgeServerConfig {
  store: ExtensionStore;
  logger: winston.Logger;
  runAnalysis?: () => Promise<void>;
}

export class McpBridgeServer {
  private server: http.Server | null = null;
  private port: number | null = null;
  private readonly config: McpBridgeServerConfig;
  private readonly logger: winston.Logger;

  constructor(config: McpBridgeServerConfig) {
    this.config = config;
    this.logger = config.logger;
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
            res.writeHead(200);
            res.end(JSON.stringify({ status: "analysis_triggered" }));
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
        res.writeHead(200);
        res.end(
          JSON.stringify({
            ruleSets: state.ruleSets,
            enhancedIncidents: state.enhancedIncidents,
            isAnalyzing: state.isAnalyzing,
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
          // For now, return the changes as acknowledged.
          // Full implementation will apply via the vertical diff manager.
          this.logger.info(
            `McpBridgeServer: received file changes for ${changes.files?.length || 0} file(s)`,
          );
          res.writeHead(200);
          res.end(
            JSON.stringify({ status: "changes_received", count: changes.files?.length || 0 }),
          );
        } catch {
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

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }
}
