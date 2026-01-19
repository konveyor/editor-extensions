import { posix } from "node:path";

/**
 * Convert an ignore file pattern to a glob pattern.
 *
 * Ignore files (.gitignore, .konveyorignore) use gitignore semantics where patterns
 * without a leading "/" or "**" match at any directory level.
 * In glob semantics, we need to add "**\/" prefix to achieve the same behavior.
 *
 * @param pattern - The ignore pattern (already joined with base path if applicable)
 * @param isRooted - Whether the original pattern was rooted (started with /)
 * @returns The equivalent glob pattern
 */
export function ignorePatternToGlob(pattern: string, isRooted: boolean = false): string {
  // Rooted patterns should NOT get **/ prefix - they only match at the specified location
  if (isRooted) {
    return pattern;
  }
  // If pattern doesn't start with **, it should match at any level
  if (!pattern.startsWith("**")) {
    return `**/${pattern}`;
  }
  return pattern;
}

/**
 * Parse an ignore file's content and convert patterns to glob format.
 *
 * Supports .gitignore, .konveyorignore, and similar ignore file formats.
 * Handles:
 * - Negation patterns (!pattern) - re-applies negation after processing
 * - Rooted patterns (/pattern) - relative to ignore file location, no **\/ prefix
 * - Regular patterns - get **\/ prefix to match at any directory level
 *
 * @param content - The raw content of the ignore file
 * @param base - The base path to join with patterns (usually relative path from workspace to ignore file)
 * @returns Array of glob patterns
 */
export function parseIgnoreFileToGlobPatterns(content: string, base: string = ""): string[] {
  return content
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((rawPattern) => {
      let pattern = rawPattern;

      // Handle negation patterns (must be preserved at the start of final result)
      const isNegated = pattern.startsWith("!");
      if (isNegated) {
        pattern = pattern.slice(1);
      }

      // Handle rooted patterns (relative to ignore file location, no **/ prefix)
      const isRooted = pattern.startsWith("/");
      if (isRooted) {
        pattern = pattern.slice(1);
      }

      // Join with base path
      const joined = base ? posix.join(base, pattern) : pattern;

      // Convert to glob pattern
      let globPattern = ignorePatternToGlob(joined, isRooted);

      // Re-apply negation
      if (isNegated) {
        globPattern = "!" + globPattern;
      }

      return globPattern;
    });
}
