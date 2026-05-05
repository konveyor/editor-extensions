/**
 * MCP Bridge Server stub — full implementation is in PR #1396.
 *
 * This stub ensures the build compiles while the MCP server package
 * PR is pending. The agent init code dynamically imports this module
 * and gracefully handles its absence at runtime.
 */

import * as http from "http";
import { randomBytes } from "crypto";
import type winston from "winston";

export interface FileChange {
  path: string;
  content: string;
}

export interface McpBridgeServerConfig {
  store: any;
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
    this.bearerToken = randomBytes(32).toString("hex");
  }

  getBearerToken(): string {
    return this.bearerToken;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.logger.error(`McpBridgeServer: unhandled error: ${err}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        });
      });

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

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url || "/", `http://127.0.0.1`);
    const pathname = url.pathname;
    const method = req.method || "GET";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Validate bearer token
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
            isAnalyzing: state.isAnalyzing,
            totalRuleSets: state.ruleSets?.length ?? 0,
            totalIncidents: state.enhancedIncidents?.length ?? 0,
          }),
        );
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
          const files: FileChange[] = changes.files ?? [];

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
