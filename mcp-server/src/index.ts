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
  "Run Konveyor static analysis on the project to find migration issues and violations",
  {},
  async () => {
    try {
      const result = await bridgeRequest("/api/run-analysis", { method: "POST" });
      return {
        content: [
          {
            type: "text" as const,
            text: `Analysis triggered successfully. ${JSON.stringify(result)}`,
          },
        ],
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
  "Get current analysis results including violations, incidents, and their details",
  {},
  async () => {
    try {
      const result = (await bridgeRequest("/api/analysis-results")) as {
        ruleSets: unknown[];
        enhancedIncidents: unknown[];
        isAnalyzing: boolean;
      };

      const summary = {
        isAnalyzing: result.isAnalyzing,
        totalRuleSets: result.ruleSets.length,
        totalIncidents: result.enhancedIncidents.length,
        incidents: result.enhancedIncidents,
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
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

// ─── Tool: apply_file_changes ─────────────────────────────────────────

server.tool(
  "apply_file_changes",
  "Apply code modifications to workspace files as part of migration",
  {
    files: z
      .array(
        z.object({
          path: z.string().describe("File path relative to workspace root"),
          content: z.string().describe("New file content"),
        }),
      )
      .describe("Array of file modifications to apply"),
  },
  async ({ files }) => {
    try {
      const result = await bridgeRequest("/api/apply-file-changes", {
        method: "POST",
        body: { files },
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Applied changes to ${files.length} file(s). ${JSON.stringify(result)}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to apply file changes: ${err instanceof Error ? err.message : String(err)}`,
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
