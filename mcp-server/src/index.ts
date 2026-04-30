/**
 * Konveyor MCP Server
 *
 * A Model Context Protocol server that exposes Konveyor analysis tools
 * to AI agents (Goose). Runs as a stdio transport server, spawned by
 * Goose as configured in the ACP session.
 *
 * Communicates with the VS Code extension via an HTTP bridge server
 * (KONVEYOR_BRIDGE_PORT env var → localhost).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_PORT = process.env.KONVEYOR_BRIDGE_PORT;

if (!BRIDGE_PORT) {
  console.error("KONVEYOR_BRIDGE_PORT environment variable is required");
  process.exit(1);
}

const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;

async function bridgeRequest(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const { method = "GET", body } = options;
  const url = `${BRIDGE_BASE}${path}`;

  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bridge request failed: ${response.status} ${text}`);
  }

  return response.json();
}

// ─── Server setup ─────────────────────────────────────────────────────

const server = new McpServer({
  name: "konveyor",
  version: "0.4.0",
});

// ─── Tool: run_analysis ───────────────────────────────────────────────

server.tool(
  "run_analysis",
  "Run Konveyor static analysis on the project. Returns a COMPLETE summary of all violations — no need to call any other tool afterward. Just present the results to the user.",
  {},
  async () => {
    try {
      const result = (await bridgeRequest("/api/run-analysis", { method: "POST" })) as {
        status: string;
        totalIncidents?: number;
        totalRuleSets?: number;
        violations?: Array<{
          violation: string;
          incidents: number;
          affectedFiles: string[];
        }>;
      };

      const lines = [
        `Analysis completed. ${result.totalIncidents ?? 0} incidents found across ${result.totalRuleSets ?? 0} rule sets.`,
      ];

      if (result.violations && result.violations.length > 0) {
        lines.push("");
        for (const v of result.violations) {
          const files = v.affectedFiles.slice(0, 5).join(", ");
          const more = v.affectedFiles.length > 5 ? ` +${v.affectedFiles.length - 5} more` : "";
          lines.push(
            `• ${v.violation}: ${v.incidents} incident${v.incidents !== 1 ? "s" : ""} (${files}${more})`,
          );
        }
      }

      if (!result.totalIncidents) {
        lines.push("No migration issues found.");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to run analysis: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ─── Tool: get_analysis_results ───────────────────────────────────────

server.tool(
  "get_analysis_results",
  "Get detailed analysis results grouped by file with line numbers. Only use this when the user explicitly asks for file-level or line-level detail — run_analysis already provides a complete summary.",
  {},
  async () => {
    try {
      const result = (await bridgeRequest("/api/analysis-results")) as {
        isAnalyzing: boolean;
        totalRuleSets: number;
        totalIncidents: number;
        fileResults: Array<{
          file: string;
          incidents: Array<{ violation: string; line?: number; message: string }>;
        }>;
      };

      const lines = [
        result.isAnalyzing ? "Analysis is currently running." : "Analysis is complete.",
        `Rule sets: ${result.totalRuleSets}`,
        `Total incidents: ${result.totalIncidents}`,
      ];

      if (result.fileResults && result.fileResults.length > 0) {
        lines.push("", "Results by file:");
        for (const fr of result.fileResults) {
          const shortPath = fr.file.split("/").slice(-3).join("/");
          lines.push(`\n${shortPath} (${fr.incidents.length} incidents):`);
          for (const inc of fr.incidents) {
            const loc = inc.line ? ` (line ${inc.line})` : "";
            lines.push(`  - [${inc.violation}]${loc}: ${inc.message}`);
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to get analysis results: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ─── Tool: get_incidents_by_file ──────────────────────────────────────

server.tool(
  "get_incidents_by_file",
  "Get migration incidents/violations for a specific file",
  {
    file: z.string().describe("The file path to get incidents for"),
  },
  async ({ file }) => {
    try {
      const result = (await bridgeRequest(
        `/api/incidents-by-file?file=${encodeURIComponent(file)}`,
      )) as { incidents: unknown[] };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                file,
                totalIncidents: result.incidents.length,
                incidents: result.incidents,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to get incidents for ${file}: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ─── Start server ─────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Konveyor MCP server failed to start:", err);
  process.exit(1);
});
