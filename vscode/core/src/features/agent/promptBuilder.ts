import * as fs from "fs/promises";
import * as path from "path";
import type { KaiInteractiveWorkflowInput } from "@editor-extensions/agentic";
import type { EnhancedIncident, AnalysisProfile } from "@editor-extensions/shared";

/**
 * Options for building migration prompts.
 */
export interface BuildMigrationPromptOptions {
  /** Active analysis profile — used to match skills by label. */
  activeProfile?: AnalysisProfile;
}

/**
 * Builds a self-contained migration prompt for goose from the same
 * KaiInteractiveWorkflowInput that the LangGraph workflow consumes.
 *
 * If migration skills exist in `.konveyor/skills/`, they are loaded and
 * included in the prompt to provide richer migration context.
 */
export async function buildMigrationPrompt(
  input: KaiInteractiveWorkflowInput,
  workspaceDir: string,
  fileContentCache?: ReadonlyMap<string, string>,
  options?: BuildMigrationPromptOptions,
): Promise<string> {
  const { incidents = [], migrationHint, programmingLanguage } = input;

  const [fileBlocks, skillBlocks] = await Promise.all([
    buildAllFileBlocks(incidents, workspaceDir, fileContentCache),
    loadSkillContent(workspaceDir, options?.activeProfile),
  ]);

  const instructions = input.enableAgentMode
    ? [
        `For each file listed above, fix ALL incidents by applying the migration.`,
        `Preserve existing formatting and imports unless the migration requires changes.`,
        `Use your built-in file editing tools to make changes directly.`,
      ]
    : [
        `For each file listed above, fix ALL incidents by applying the migration.`,
        `Preserve existing formatting and imports unless the migration requires changes.`,
        `Use the write_file tool to output the COMPLETE updated file content for each file you change.`,
        `Do not skip unchanged files. Only call write_file for files that need modifications.`,
      ];

  const sections: string[] = [
    `You are a migration assistant. Apply the following migration to the codebase.`,
    ``,
    `**Migration**: ${migrationHint}`,
    `**Language**: ${programmingLanguage}`,
    ``,
  ];

  if (skillBlocks.length > 0) {
    sections.push(`## Migration Context`, ``, ...skillBlocks, ``);
  }

  sections.push(`## Incidents to fix`, ``, ...fileBlocks, `## Instructions`, ``, ...instructions);

  return sections.join("\n");
}

async function buildAllFileBlocks(
  incidents: EnhancedIncident[],
  workspaceDir: string,
  fileContentCache?: ReadonlyMap<string, string>,
): Promise<string[]> {
  const byUri = groupByUri(incidents);
  return Promise.all(
    Array.from(byUri.entries()).map(([uri, fileIncidents]) =>
      buildFileBlock(uri, fileIncidents, workspaceDir, fileContentCache),
    ),
  );
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
  fileContentCache?: ReadonlyMap<string, string>,
): Promise<string> {
  const filePath = uriToRelative(uri, workspaceDir);
  const lines: string[] = [`### ${filePath}`, ``];

  let fileContent: string | undefined;
  const absPath = uriToAbsolute(uri, workspaceDir);
  fileContent = fileContentCache?.get(absPath);
  if (fileContent === undefined) {
    try {
      fileContent = await fs.readFile(absPath, "utf-8");
    } catch {
      // File may not be readable; proceed without content
    }
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

/**
 * Load migration skill files from `.konveyor/skills/` and return their
 * content as prompt sections. Skills are filtered by label if an active
 * profile is provided.
 */
async function loadSkillContent(
  workspaceDir: string,
  activeProfile?: AnalysisProfile,
): Promise<string[]> {
  const skillsDir = path.join(workspaceDir, ".konveyor", "skills");

  let files: string[];
  try {
    files = await fs.readdir(skillsDir);
  } catch {
    return [];
  }

  const mdFiles = files.filter((f) => f.endsWith(".md"));
  if (mdFiles.length === 0) {
    return [];
  }

  const blocks: string[] = [];
  const profileLabels = activeProfile ? parseLabelsFromSelector(activeProfile.labelSelector) : null;

  for (const file of mdFiles) {
    try {
      const content = await fs.readFile(path.join(skillsDir, file), "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);

      // If the skill has labels and we have a profile, check for overlap
      const fmLabels = frontmatter.labels;
      if (profileLabels && Array.isArray(fmLabels) && fmLabels.length > 0) {
        const skillLabels = new Set(fmLabels as string[]);
        const hasOverlap = profileLabels.some((l) => skillLabels.has(l));
        if (!hasOverlap) {
          continue;
        }
      }

      // Include the skill body (without frontmatter) in the prompt
      const title = (frontmatter.name as string) || file.replace(/\.md$/, "");
      blocks.push(`### Skill: ${title}`, ``, body.trim(), ``);
    } catch {
      // Skip unreadable files
    }
  }

  return blocks;
}

/**
 * Extract individual labels from a profile labelSelector string.
 * e.g. "(konveyor.io/target=quarkus || konveyor.io/target=cloud-readiness)"
 * → ["konveyor.io/target=quarkus", "konveyor.io/target=cloud-readiness"]
 */
function parseLabelsFromSelector(selector: string): string[] {
  const matches = selector.match(/konveyor\.io\/[\w-]+=[\w.-]+/g);
  return matches ?? [];
}

/**
 * Minimal YAML frontmatter parser. Extracts the block between --- delimiters
 * and parses key-value pairs. Returns the frontmatter as a record and the
 * remaining body.
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const raw = match[1];
  const body = match[2];
  const frontmatter: Record<string, unknown> = {};

  let currentKey: string | null = null;
  let listValues: string[] | null = null;

  for (const line of raw.split("\n")) {
    // List item under a key
    if (listValues !== null && /^\s+-\s+/.test(line)) {
      listValues.push(line.replace(/^\s+-\s+/, "").trim());
      continue;
    }

    // Flush previous list
    if (listValues !== null && currentKey) {
      frontmatter[currentKey] = listValues;
      listValues = null;
      currentKey = null;
    }

    const kvMatch = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      const value = kvMatch[2].trim();

      if (value === "" || value === ">") {
        // Could be a list or multi-line value — start collecting
        currentKey = key;
        listValues = [];
      } else if (value.startsWith("[") && value.endsWith("]")) {
        // Inline array: [java, go]
        frontmatter[key] = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim());
      } else {
        frontmatter[key] = value;
      }
    }
  }

  // Flush trailing list
  if (listValues !== null && currentKey) {
    frontmatter[currentKey] = listValues;
  }

  return { frontmatter, body };
}
