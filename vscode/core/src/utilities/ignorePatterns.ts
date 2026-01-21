import ignore, { Ignore } from "ignore";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Priority order for ignore files. First found is used.
 */
export const IGNORE_FILE_PRIORITY = [".konveyorignore", ".gitignore"];

/**
 * Default patterns to ignore when no ignore file is found.
 */
export const DEFAULT_IGNORE_PATTERNS = [".git", ".vscode", "target", "node_modules"];

/**
 * Patterns that are always ignored, regardless of ignore file contents.
 */
export const ALWAYS_IGNORE_PATTERNS = [".konveyor"];

/**
 * Create an ignore instance from the first available ignore file in the workspace.
 *
 * Uses the `ignore` npm package which properly implements gitignore specification,
 * handling all edge cases including:
 * - Negation patterns (!pattern)
 * - Rooted patterns (/pattern)
 * - Directory markers (pattern/)
 * - Wildcards (*, **, ?)
 * - Escaped characters
 *
 * @param workspaceRoot - The root directory of the workspace
 * @returns An object with the ignore instance and the file that was loaded
 */
export function createIgnoreFromWorkspace(workspaceRoot: string): {
  ig: Ignore;
  ignoreFile: string | null;
} {
  const ig = ignore();

  // Always add the always-ignore patterns
  ig.add(ALWAYS_IGNORE_PATTERNS);

  // Try to find and load an ignore file
  for (const filename of IGNORE_FILE_PRIORITY) {
    const filepath = join(workspaceRoot, filename);
    if (existsSync(filepath)) {
      try {
        const content = readFileSync(filepath, "utf-8");
        ig.add(content);
        return { ig, ignoreFile: filepath };
      } catch {
        // File exists but couldn't be read, try next
      }
    }
  }

  // No ignore file found, use defaults
  ig.add(DEFAULT_IGNORE_PATTERNS);
  return { ig, ignoreFile: null };
}

/**
 * Filter an array of paths to only include those that should be ignored.
 *
 * @param paths - Array of paths relative to the workspace root
 * @param ig - The ignore instance to use for filtering
 * @returns Array of paths that are ignored
 */
export function filterIgnoredPaths(paths: string[], ig: Ignore): string[] {
  return paths.filter((p) => {
    // The ignore package expects paths without leading ./
    const normalized = p.startsWith("./") ? p.slice(2) : p;
    // For directories, also try with trailing slash
    return ig.ignores(normalized) || ig.ignores(normalized + "/");
  });
}

/**
 * Check if a single path should be ignored.
 *
 * @param path - Path relative to the workspace root
 * @param ig - The ignore instance to use
 * @returns true if the path should be ignored
 */
export function isPathIgnored(path: string, ig: Ignore): boolean {
  const normalized = path.startsWith("./") ? path.slice(2) : path;
  return ig.ignores(normalized) || ig.ignores(normalized + "/");
}

/**
 * Extract the raw patterns from an ignore file for use with glob operations.
 *
 * This reads the ignore file directly and returns the patterns as an array.
 * Unlike using the ignore instance for filtering, this is useful for glob-based
 * directory discovery where we want to avoid traversing into ignored directories.
 *
 * @param workspaceRoot - The root directory of the workspace
 * @returns Array of ignore patterns from the file, or defaults if no file found
 */
export function getIgnorePatternsForGlob(workspaceRoot: string): string[] {
  // Start with always-ignore patterns
  const patterns = [...ALWAYS_IGNORE_PATTERNS];

  // Try to find and load an ignore file
  for (const filename of IGNORE_FILE_PRIORITY) {
    const filepath = join(workspaceRoot, filename);
    if (existsSync(filepath)) {
      try {
        const content = readFileSync(filepath, "utf-8");
        const filePatterns = content
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"));
        return [...patterns, ...filePatterns];
      } catch {
        // File exists but couldn't be read, try next
      }
    }
  }

  // No ignore file found, use defaults
  return [...patterns, ...DEFAULT_IGNORE_PATTERNS];
}
