/**
 * Utility functions for diff processing and line ending normalization
 */

/**
 * Normalize line endings to LF (\n) for consistent diff processing
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Check if the only differences in a unified diff are line endings
 */
export function isOnlyLineEndingDiff(unifiedDiff: string): boolean {
  const lines = unifiedDiff.split("\n");
  const changeLines: string[] = [];

  // Collect all +/- lines
  for (const line of lines) {
    // Skip diff headers and context markers
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@") ||
      line.startsWith(" ")
    ) {
      continue;
    }

    // Collect actual change lines
    if (line.startsWith("+") || line.startsWith("-")) {
      changeLines.push(line);
    }
  }

  // If no changes, not a line ending diff
  if (changeLines.length === 0) {
    return false;
  }

  // Check if changes come in pairs where the only difference is line endings
  for (let i = 0; i < changeLines.length; i += 2) {
    if (i + 1 >= changeLines.length) {
      return false; // Unpaired change
    }

    const removedLine = changeLines[i];
    const addedLine = changeLines[i + 1];

    // Must be a - followed by a +
    if (!removedLine.startsWith("-") || !addedLine.startsWith("+")) {
      return false;
    }

    const removedContent = removedLine.substring(1);
    const addedContent = addedLine.substring(1);

    // Check if they're the same after normalizing line endings
    if (normalizeLineEndings(removedContent) !== normalizeLineEndings(addedContent)) {
      return false;
    }
  }

  return true;
}

/**
 * Normalize a unified diff by removing line-ending-only changes
 */
export function normalizeUnifiedDiff(
  unifiedDiff: string,
  originalContent: string,
  newContent: string,
): string {
  // First normalize line endings in both contents
  const normalizedOriginal = normalizeLineEndings(originalContent);
  const normalizedNew = normalizeLineEndings(newContent);

  // If contents are identical after normalization, return empty diff
  if (normalizedOriginal === normalizedNew) {
    return "";
  }

  // Otherwise, return the original diff (it has real content changes)
  return unifiedDiff;
}

/**
 * Check if a unified diff has no meaningful content after processing
 */
export function hasNoMeaningfulDiffContent(unifiedDiff: string): boolean {
  if (!unifiedDiff || unifiedDiff.trim() === "") {
    return true;
  }

  const lines = unifiedDiff.split("\n");
  const filteredLines = filterLineEndingOnlyChanges(lines);

  let formattedDiff = "";
  let inHunk = false;

  for (const line of filteredLines) {
    if (line.startsWith("diff ")) {
      continue;
    }

    if (line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }

    if (line.startsWith("@@")) {
      inHunk = true;
      formattedDiff += line + "\n";
      continue;
    }

    if (inHunk) {
      formattedDiff += line + "\n";
    }
  }

  return !formattedDiff.trim();
}

/**
 * Filter out diff lines that only differ in line endings
 */
export function filterLineEndingOnlyChanges(diffLines: string[]): string[] {
  const filtered: string[] = [];
  let i = 0;

  while (i < diffLines.length) {
    const line = diffLines[i];

    // Keep headers and context markers
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@") ||
      line.startsWith(" ")
    ) {
      filtered.push(line);
      i++;
      continue;
    }

    // Check for paired +/- lines that only differ in line endings
    if (line.startsWith("-") && i + 1 < diffLines.length) {
      const nextLine = diffLines[i + 1];

      if (nextLine.startsWith("+")) {
        const removedContent = normalizeLineEndings(line.substring(1));
        const addedContent = normalizeLineEndings(nextLine.substring(1));

        // If they're the same after normalization, skip both lines
        if (removedContent === addedContent) {
          i += 2; // Skip both lines
          continue;
        } else {
          // They're different - keep both lines
          filtered.push(line);
          filtered.push(nextLine);
          i += 2;
          continue;
        }
      }
    }

    // Keep the line if it's not just a line ending change
    filtered.push(line);
    i++;
  }

  return filtered;
}
