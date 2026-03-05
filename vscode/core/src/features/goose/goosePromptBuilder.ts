import * as fs from "fs/promises";
import * as path from "path";
import type { KaiInteractiveWorkflowInput } from "@editor-extensions/agentic";
import type { EnhancedIncident } from "@editor-extensions/shared";

/**
 * Builds a self-contained migration prompt for goose from the same
 * KaiInteractiveWorkflowInput that the LangGraph workflow consumes.
 */
export async function buildMigrationPrompt(
  input: KaiInteractiveWorkflowInput,
  workspaceDir: string,
): Promise<string> {
  const { incidents = [], migrationHint, programmingLanguage } = input;

  const byUri = groupByUri(incidents);
  const fileBlocks = await Promise.all(
    Array.from(byUri.entries()).map(([uri, fileIncidents]) =>
      buildFileBlock(uri, fileIncidents, workspaceDir),
    ),
  );

  return [
    `You are a migration assistant. Apply the following migration to the codebase.`,
    ``,
    `**Migration**: ${migrationHint}`,
    `**Language**: ${programmingLanguage}`,
    ``,
    `## Incidents to fix`,
    ``,
    ...fileBlocks,
    `## Instructions`,
    ``,
    `For each file listed above, fix ALL incidents by applying the migration.`,
    `Preserve existing formatting and imports unless the migration requires changes.`,
    ``,
    `**Important**: After making changes to files, you MUST call the \`apply_file_changes\` tool`,
    `from the konveyor MCP server to submit your modifications. Pass the full updated file`,
    `content for each file you changed. This routes changes through the review system so the`,
    `user can accept or reject them. Do NOT skip this step.`,
  ].join("\n");
}

function groupByUri(incidents: EnhancedIncident[]): Map<string, EnhancedIncident[]> {
  const map = new Map<string, EnhancedIncident[]>();
  for (const inc of incidents) {
    const list = map.get(inc.uri) ?? [];
    list.push(inc);
    map.set(inc.uri, list);
  }
  return map;
}

async function buildFileBlock(
  uri: string,
  incidents: EnhancedIncident[],
  workspaceDir: string,
): Promise<string> {
  const filePath = uriToRelative(uri, workspaceDir);
  const lines: string[] = [`### ${filePath}`, ``];

  let fileContent: string | undefined;
  try {
    const absPath = uriToAbsolute(uri, workspaceDir);
    fileContent = await fs.readFile(absPath, "utf-8");
  } catch {
    // File may not be readable; proceed without content
  }

  for (const inc of incidents) {
    const loc = inc.lineNumber ? ` (line ${inc.lineNumber})` : "";
    const rule = inc.violation_name ? ` [${inc.violation_name}]` : "";
    lines.push(`- ${inc.message}${loc}${rule}`);
    if (inc.violation_description && inc.violation_description !== inc.message) {
      lines.push(`  Description: ${inc.violation_description}`);
    }
  }

  if (fileContent) {
    lines.push(``);
    lines.push(`Current file contents:`);
    lines.push("```");
    lines.push(fileContent);
    lines.push("```");
  }

  lines.push(``);
  return lines.join("\n");
}

function uriToAbsolute(uri: string, workspaceDir: string): string {
  if (uri.startsWith("file://")) {
    return new URL(uri).pathname;
  }
  if (path.isAbsolute(uri)) {
    return uri;
  }
  return path.join(workspaceDir, uri);
}

function uriToRelative(uri: string, workspaceDir: string): string {
  const abs = uriToAbsolute(uri, workspaceDir);
  return path.relative(workspaceDir, abs) || abs;
}
