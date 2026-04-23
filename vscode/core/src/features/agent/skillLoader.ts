import * as fs from "fs/promises";
import * as path from "path";

/**
 * Represents a single skill entry with metadata and location.
 */
export interface SkillEntry {
  /** Unique skill name from YAML frontmatter */
  name: string;
  /** Human-readable description from YAML frontmatter */
  description: string;
  /** Directory containing the SKILL.md file */
  skillDir: string;
  /** Absolute path to the SKILL.md file */
  skillMdPath: string;
  /** Source layer where this skill was loaded from */
  source: "package" | "hub" | "workspace";
}

/**
 * Map of skill name to SkillEntry.
 */
export type SkillIndex = Map<string, SkillEntry>;

/**
 * YAML frontmatter extracted from a SKILL.md file.
 */
interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/**
 * Parses YAML frontmatter from markdown content.
 * Frontmatter is enclosed between `---` delimiters at the start of the file.
 *
 * @param content - The markdown file content
 * @returns Parsed frontmatter object or null if not found
 */
function parseFrontmatter(content: string): SkillFrontmatter | null {
  // Match frontmatter between --- delimiters at the start of the file
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return null;
  }

  const yamlContent = match[1];
  const result: SkillFrontmatter = {};

  // Simple YAML parsing for name and description fields
  for (const line of yamlContent.split(/\r?\n/)) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      result.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    }

    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) {
      result.description = descMatch[1].trim().replace(/^["']|["']$/g, "");
    }
  }

  return result;
}

/**
 * Checks if a directory exists and is accessible.
 *
 * @param dirPath - Path to check
 * @returns True if directory exists
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Loads skill entries from a single directory.
 * Each subdirectory containing a SKILL.md file is treated as a skill.
 *
 * @param skillsDir - Directory to scan for skills
 * @param source - Source layer for these skills
 * @returns Array of skill entries found
 */
async function loadSkillsFromDir(
  skillsDir: string,
  source: SkillEntry["source"],
): Promise<SkillEntry[]> {
  if (!(await directoryExists(skillsDir))) {
    return [];
  }

  const entries: SkillEntry[] = [];

  try {
    const items = await fs.readdir(skillsDir, { withFileTypes: true });

    for (const item of items) {
      if (!item.isDirectory()) {
        continue;
      }

      const skillDir = path.join(skillsDir, item.name);
      const skillMdPath = path.join(skillDir, "SKILL.md");

      try {
        const content = await fs.readFile(skillMdPath, "utf-8");
        const frontmatter = parseFrontmatter(content);

        if (frontmatter?.name) {
          entries.push({
            name: frontmatter.name,
            description: frontmatter.description ?? "",
            skillDir,
            skillMdPath,
            source,
          });
        }
      } catch {
        // SKILL.md doesn't exist or is unreadable, skip this directory
      }
    }
  } catch {
    // Directory unreadable, return empty
  }

  return entries;
}

/**
 * Builds a SkillIndex by loading skills from three layers in priority order.
 * Later layers override earlier ones (workspace > hub > package).
 *
 * Layer order (earlier = lower priority):
 * 1. Package defaults: `<extensionPath>/packages/migration-intelligence/skills/`
 * 2. Hub-distributed: `.konveyor/profiles/<id>/skills/` (all profile subdirectories)
 * 3. Workspace-local: `.konveyor/skills/`
 *
 * @param extensionPath - Path to the VS Code extension
 * @param workspaceRoot - Path to the workspace root directory
 * @returns Map of skill name to SkillEntry
 */
export async function buildSkillIndex(
  extensionPath: string,
  workspaceRoot: string,
): Promise<SkillIndex> {
  const index: SkillIndex = new Map();

  // Layer 1: Package defaults
  const packageSkillsDir = path.join(extensionPath, "packages", "migration-intelligence", "skills");
  const packageSkills = await loadSkillsFromDir(packageSkillsDir, "package");
  for (const skill of packageSkills) {
    index.set(skill.name, skill);
  }

  // Layer 2: Hub-distributed profiles
  const profilesDir = path.join(workspaceRoot, ".konveyor", "profiles");
  if (await directoryExists(profilesDir)) {
    try {
      const profileItems = await fs.readdir(profilesDir, { withFileTypes: true });
      for (const profileItem of profileItems) {
        if (!profileItem.isDirectory()) {
          continue;
        }
        const profileSkillsDir = path.join(profilesDir, profileItem.name, "skills");
        const hubSkills = await loadSkillsFromDir(profileSkillsDir, "hub");
        for (const skill of hubSkills) {
          index.set(skill.name, skill);
        }
      }
    } catch {
      // Profiles directory unreadable
    }
  }

  // Layer 3: Workspace-local
  const workspaceSkillsDir = path.join(workspaceRoot, ".konveyor", "skills");
  const workspaceSkills = await loadSkillsFromDir(workspaceSkillsDir, "workspace");
  for (const skill of workspaceSkills) {
    index.set(skill.name, skill);
  }

  return index;
}

/**
 * Loads the full content of a SKILL.md file.
 *
 * @param skillMdPath - Absolute path to the SKILL.md file
 * @returns The full file content as a string
 * @throws Error if file cannot be read
 */
export async function loadSkillContent(skillMdPath: string): Promise<string> {
  return fs.readFile(skillMdPath, "utf-8");
}

/**
 * Loads a prompt file by name from available locations.
 *
 * Search order (first found wins):
 * 1. Workspace-local: `.konveyor/prompts/{promptName}.md`
 * 2. Package defaults: `<extensionPath>/packages/migration-intelligence/prompts/{promptName}.md`
 *
 * @param promptName - Name of the prompt (without .md extension)
 * @param extensionPath - Path to the VS Code extension
 * @param workspaceRoot - Path to the workspace root directory
 * @returns The prompt content or null if not found
 */
export async function loadPrompt(
  promptName: string,
  extensionPath: string,
  workspaceRoot: string,
): Promise<string | null> {
  const filename = `${promptName}.md`;

  // Try workspace-local first (higher priority)
  const workspacePromptPath = path.join(workspaceRoot, ".konveyor", "prompts", filename);
  try {
    return await fs.readFile(workspacePromptPath, "utf-8");
  } catch {
    // Not found in workspace, try package
  }

  // Try package defaults
  const packagePromptPath = path.join(
    extensionPath,
    "packages",
    "migration-intelligence",
    "prompts",
    filename,
  );
  try {
    return await fs.readFile(packagePromptPath, "utf-8");
  } catch {
    // Not found
  }

  return null;
}

/**
 * Gets a skill by name from the index and loads its content.
 *
 * @param skillIndex - The skill index to search
 * @param skillName - Name of the skill to load
 * @returns Object with skill entry and content, or null if not found
 */
export async function getSkillWithContent(
  skillIndex: SkillIndex,
  skillName: string,
): Promise<{ entry: SkillEntry; content: string } | null> {
  const entry = skillIndex.get(skillName);
  if (!entry) {
    return null;
  }

  try {
    const content = await loadSkillContent(entry.skillMdPath);
    return { entry, content };
  } catch {
    return null;
  }
}
