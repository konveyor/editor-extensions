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
 * - GET  /api/migration-context  → Get active profile, labels, and skill paths
 * - GET  /api/skills             → List existing migration skill files
 * - POST /api/skills             → Save a migration skill file
 */

import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import winston from "winston";
import { type ExtensionStore } from "../store/extensionStore";

/** Strip file:// prefix from workspace root if present. */
function toFsPath(p: string): string {
  if (p.startsWith("file://")) {
    return fileURLToPath(p);
  }
  if (p.startsWith("file:")) {
    return p.slice(5);
  }
  return p;
}

export interface FileChange {
  path: string;
  content: string;
}

export interface AskUserQuestion {
  question: string;
  options: string[];
}

export interface McpBridgeServerConfig {
  store: ExtensionStore;
  logger: winston.Logger;
  runAnalysis?: () => Promise<void>;
  onFileChanges?: (files: FileChange[]) => Promise<void>;
  onAskUser?: (
    batchId: string,
    questions: Array<{
      questionId: string;
      question: string;
      quickResponses: Array<{ id: string; content: string }>;
    }>,
  ) => void;
}

export class McpBridgeServer {
  private server: http.Server | null = null;
  private port: number | null = null;
  private readonly config: McpBridgeServerConfig;
  private readonly logger: winston.Logger;
  private pendingQuestions = new Map<
    string,
    { resolve: (answer: string) => void; timer: NodeJS.Timeout }
  >();

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
    // Resolve any pending questions so HTTP connections close cleanly
    for (const [batchId, pending] of this.pendingQuestions) {
      clearTimeout(pending.timer);
      pending.resolve("__SHUTDOWN__");
      this.pendingQuestions.delete(batchId);
    }

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

  /** Resolve a pending ask-user question batch. Returns true if found. */
  resolveQuestion(batchId: string, answer: string): boolean {
    const pending = this.pendingQuestions.get(batchId);
    if (!pending) {
      return false;
    }
    clearTimeout(pending.timer);
    this.pendingQuestions.delete(batchId);
    pending.resolve(answer);
    return true;
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
          const files: FileChange[] = changes.files ?? [];
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

      case "/api/migration-context": {
        const state = this.config.store.getState();
        const activeProfile = state.profiles.find((p) => p.id === state.activeProfileId);
        const skillsDir = path.join(toFsPath(state.workspaceRoot), ".konveyor", "skills");
        const existingSkills = this.listSkillFiles(skillsDir);

        res.writeHead(200);
        res.end(
          JSON.stringify({
            workspaceRoot: state.workspaceRoot,
            profile: activeProfile
              ? {
                  id: activeProfile.id,
                  name: activeProfile.name,
                  labelSelector: activeProfile.labelSelector,
                  source: activeProfile.source,
                }
              : null,
            availableSources: state.availableSources,
            availableTargets: state.availableTargets,
            existingSkills,
          }),
        );
        break;
      }

      case "/api/skills": {
        const state = this.config.store.getState();
        const skillsDir = path.join(toFsPath(state.workspaceRoot), ".konveyor", "skills");

        if (method === "GET") {
          const skills = this.loadSkillFiles(skillsDir);
          res.writeHead(200);
          res.end(JSON.stringify({ skills }));
          break;
        }

        if (method === "POST") {
          const body = await this.readBody(req);
          try {
            const { name, content } = JSON.parse(body) as {
              name?: string;
              content?: string;
            };
            if (!name || !content) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: "Missing 'name' or 'content' field" }));
              break;
            }

            // Sanitize filename
            const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
            const filename = safeName.endsWith(".md") ? safeName : `${safeName}.md`;
            const filePath = path.join(skillsDir, filename);

            // Ensure directory exists
            fs.mkdirSync(skillsDir, { recursive: true });
            fs.writeFileSync(filePath, content, "utf-8");

            this.logger.info(`McpBridgeServer: saved skill file ${filePath}`);
            res.writeHead(201);
            res.end(JSON.stringify({ status: "saved", path: filePath, filename }));
          } catch (err) {
            this.logger.error("McpBridgeServer: error saving skill", err);
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
          }
          break;
        }

        res.writeHead(405);
        res.end(JSON.stringify({ error: "Method not allowed" }));
        break;
      }

      case "/api/ask-user": {
        if (method !== "POST") {
          res.writeHead(405);
          res.end(JSON.stringify({ error: "Method not allowed" }));
          break;
        }

        // Disable socket timeout — user may take a while to respond
        res.socket?.setTimeout(0);

        const body = await this.readBody(req);
        try {
          const { questions } = JSON.parse(body) as {
            questions?: Array<{ question: string; options: string[] }>;
          };
          if (!questions || questions.length === 0) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "Missing questions array" }));
            break;
          }

          const batchId = `askq-${Date.now()}`;
          const formattedQuestions = questions.map((q, i) => {
            const questionId = `${batchId}-${i}`;
            return {
              questionId,
              question: q.question,
              quickResponses: q.options.map((opt, j) => ({
                id: `${questionId}-opt-${j}`,
                content: opt,
              })),
            };
          });

          if (this.config.onAskUser) {
            this.config.onAskUser(batchId, formattedQuestions);
          }

          // Long-poll: wait for user to answer all questions
          const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
          const answer = await new Promise<string>((resolve) => {
            const timer = setTimeout(() => {
              this.pendingQuestions.delete(batchId);
              resolve("__TIMEOUT__");
            }, TIMEOUT_MS);
            this.pendingQuestions.set(batchId, { resolve, timer });
          });

          if (answer === "__TIMEOUT__") {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                answer: "The user did not respond within the timeout period.",
                timedOut: true,
              }),
            );
          } else {
            res.writeHead(200);
            res.end(JSON.stringify({ answer }));
          }
        } catch (err) {
          this.logger.error("McpBridgeServer: error processing ask-user", err);
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

  /** List skill filenames in the skills directory. */
  private listSkillFiles(skillsDir: string): string[] {
    try {
      if (!fs.existsSync(skillsDir)) {
        return [];
      }
      return fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
    } catch {
      return [];
    }
  }

  /** Load skill files with their content. */
  private loadSkillFiles(skillsDir: string): Array<{ filename: string; content: string }> {
    const filenames = this.listSkillFiles(skillsDir);
    return filenames.map((filename) => {
      const content = fs.readFileSync(path.join(skillsDir, filename), "utf-8");
      return { filename, content };
    });
  }
}
