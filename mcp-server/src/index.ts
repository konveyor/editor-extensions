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

// ─── Tool: get_migration_context ─────────────────────────────────────

server.tool(
  "get_migration_context",
  `Get the current migration context for this project.

Returns the active analysis profile (name, label selector with source/target
labels), the workspace root path, and a list of any existing migration skill
files. Use this to understand what migration is being performed before
creating or updating migration skills.

After calling this tool, explain to the user what migration is configured
and what you plan to do next.`,
  {},
  async () => {
    try {
      const result = await bridgeRequest("/api/migration-context");
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to get migration context: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ─── Tool: get_migration_skills ─────────────────────────────────────

server.tool(
  "get_migration_skills",
  `List existing migration skill files for this project.

Returns the content of all skill files in .konveyor/skills/. Skills are
markdown files with YAML frontmatter that capture institutional knowledge
about a migration — patterns, conventions, things to preserve, common
pitfalls. They are used to provide richer context to the AI when generating
migration solutions.`,
  {},
  async () => {
    try {
      const result = (await bridgeRequest("/api/skills")) as {
        skills: Array<{ filename: string; content: string }>;
      };

      if (result.skills.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No migration skills found. Use save_migration_skill to create one.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to get migration skills: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ─── Tool: ask_user ─────────────────────────────────────────────────

server.tool(
  "ask_user",
  `Ask the user one or more questions and wait for their responses.

Use this tool when you need user input during migration skill creation —
for example, to ask about organizational conventions, preferred frameworks,
or migration constraints. Each question is presented with clickable options
in the Konveyor chat UI.

The tool returns immediately after posting the questions. The user's
responses will be delivered as your next message. Do NOT call any other
tools until you receive the user's answers.`,
  {
    questions: z
      .array(
        z.object({
          question: z.string().describe("The question to ask"),
          options: z.array(z.string()).min(2).max(6).describe("Response options (2-6 choices)"),
        }),
      )
      .min(1)
      .max(10)
      .describe("List of questions to ask the user"),
  },
  async ({ questions }) => {
    try {
      const result = (await bridgeRequest("/api/ask-user", {
        method: "POST",
        body: { questions },
      })) as { answer?: string; timedOut?: boolean };

      if (result.timedOut) {
        return {
          content: [
            {
              type: "text" as const,
              text: "The user did not respond within the timeout period. Proceed with reasonable defaults.",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `User responses:\n\n${result.answer}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to ask user: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ─── Tool: save_migration_skill ─────────────────────────────────────

server.tool(
  "save_migration_skill",
  `Save a migration skill file that captures knowledge about this migration.

A skill is a markdown file stored in .konveyor/skills/. It captures
institutional knowledge that makes future migration solutions better —
patterns found in the codebase, organizational conventions, things to
preserve, common pitfalls, and migration-specific guidance.

IMPORTANT: Before calling this tool, you MUST:

1. Tell the user what you've learned so far from the analysis results
   and codebase exploration. Summarize the key patterns you found and
   the migration approach you'd recommend.

2. Use the ask_user tool to ask about organizational preferences,
   conventions, or constraints. For example:
   - Preferred frameworks or libraries
   - Files or patterns that should not be modified
   - Internal conventions not visible in the code
   - Known gotchas from previous migration attempts

3. Only after the user has responded to your questions, call this
   tool to save the skill.

Structure the skill content as a markdown document with clear sections
covering: application context, key patterns found, migration guidance,
things to preserve, and common pitfalls.`,
  {
    name: z
      .string()
      .describe("Short kebab-case name for the skill file (e.g. 'coolstore-javaee-to-quarkus')"),
    content: z
      .string()
      .describe("Full markdown content of the skill file, including YAML frontmatter"),
  },
  async ({ name, content }) => {
    try {
      const result = (await bridgeRequest("/api/skills", {
        method: "POST",
        body: { name, content },
      })) as { status: string; path: string; filename: string };

      return {
        content: [
          {
            type: "text" as const,
            text: `Migration skill saved successfully.\n\nFile: ${result.filename}\nPath: ${result.path}\n\nThis skill will be included in future migration solution prompts to provide richer context.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to save migration skill: ${err instanceof Error ? err.message : String(err)}`,
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
