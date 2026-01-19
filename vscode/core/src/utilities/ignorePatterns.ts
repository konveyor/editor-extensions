import { posix } from "node:path";

/**
 * Convert an ignore file pattern to a glob pattern.
 *
 * Ignore files (.gitignore, .konveyorignore) use gitignore semantics where patterns
 * without a leading "/" or "**" match at any directory level.
 * In glob semantics, we need to add "**\/" prefix to achieve the same behavior.
 *
 * @param pattern - The ignore pattern (already joined with base path if applicable)
 * @returns The equivalent glob pattern
 */
export function ignorePatternToGlob(pattern: string): string {
  // If pattern doesn't start with / or **, it should match at any level
  if (!pattern.startsWith("/") && !pattern.startsWith("**")) {
    return `**/${pattern}`;
  }
  return pattern;
}

/**
 * Parse an ignore file's content and convert patterns to glob format.
 *
 * Supports .gitignore, .konveyorignore, and similar ignore file formats.
 *
 * @param content - The raw content of the ignore file
 * @param base - The base path to join with patterns (usually relative path from workspace to ignore file)
 * @returns Array of glob patterns
 */
export function parseIgnoreFileToGlobPatterns(content: string, base: string = ""): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((pattern) => {
      const joined = posix.join(base, pattern);
      return ignorePatternToGlob(joined);
    });
}
