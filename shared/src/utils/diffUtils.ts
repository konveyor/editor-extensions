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
  const specialMarkers: string[] = [];

  // Collect all +/- lines and special markers
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

    // Collect special markers (e.g., "\ No newline at end of file")
    if (line.startsWith("\\")) {
      specialMarkers.push(line);
      continue;
    }

    // Collect actual change lines
    if (line.startsWith("+") || line.startsWith("-")) {
      changeLines.push(line);
    }
  }

  // If no changes, not a line ending diff
  if (changeLines.length === 0) {
    // Check if only special markers exist (which might indicate line ending differences)
    return specialMarkers.some((marker) => marker.includes("No newline at end of file"));
  }

  // Process changes to check if they're only line ending differences
  let i = 0;
  while (i < changeLines.length) {
    const removedLine = changeLines[i];

    // Must start with -
    if (!removedLine.startsWith("-")) {
      return false;
    }

    // Find the corresponding + line (might not be immediately after)
    let j = i + 1;
    while (j < changeLines.length && changeLines[j].startsWith("-")) {
      j++;
    }

    if (j >= changeLines.length || !changeLines[j].startsWith("+")) {
      return false; // No matching + line found
    }

    const addedLine = changeLines[j];
    const removedContent = removedLine.substring(1);
    const addedContent = addedLine.substring(1);

    // Normalize and compare, handling various line ending representations
    const normalizedRemoved = normalizeLineEndings(removedContent).trimEnd();
    const normalizedAdded = normalizeLineEndings(addedContent).trimEnd();

    // If content differs after normalization, it's not just a line ending change
    if (normalizedRemoved !== normalizedAdded) {
      return false;
    }

    // Move to next unprocessed line
    i = j + 1;
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

  let hasActualChanges = false;
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
      continue;
    }

    if (inHunk) {
      // Check for actual changes (not just context lines)
      if (line.startsWith("+") || line.startsWith("-")) {
        hasActualChanges = true;
        break;
      }
    }
  }

  return !hasActualChanges;
}

/**
 * Filter out diff lines that only differ in line endings
 */
export function filterLineEndingOnlyChanges(diffLines: string[]): string[] {
  const filtered: string[] = [];
  let i = 0;

  // First, collect all removed and added lines in the current hunk
  const removedLines: { index: number; content: string }[] = [];
  const addedLines: { index: number; content: string }[] = [];
  let inHunk = false;

  // Helper function to process collected lines
  const processHunkLines = () => {
    if (removedLines.length === 0 || addedLines.length === 0) {
      // No pairs to compare, keep all lines
      removedLines.forEach((item) => filtered.push(diffLines[item.index]));
      addedLines.forEach((item) => filtered.push(diffLines[item.index]));
    } else if (removedLines.length === addedLines.length) {
      // Check if all pairs only differ in line endings
      let allLineEndingChanges = true;
      for (let k = 0; k < removedLines.length; k++) {
        const normalizedRemoved = normalizeLineEndings(removedLines[k].content).trimEnd();
        const normalizedAdded = normalizeLineEndings(addedLines[k].content).trimEnd();
        if (normalizedRemoved !== normalizedAdded) {
          allLineEndingChanges = false;
          break;
        }
      }

      if (!allLineEndingChanges) {
        // Not all changes are line-ending only, keep all lines
        removedLines.forEach((item) => filtered.push(diffLines[item.index]));
        addedLines.forEach((item) => filtered.push(diffLines[item.index]));
      }
      // If all are line-ending changes, we skip them (don't add to filtered)
    } else {
      // Different number of removed/added lines, keep all
      removedLines.forEach((item) => filtered.push(diffLines[item.index]));
      addedLines.forEach((item) => filtered.push(diffLines[item.index]));
    }

    // Clear collections
    removedLines.length = 0;
    addedLines.length = 0;
  };

  while (i < diffLines.length) {
    const line = diffLines[i];

    // Keep headers and context markers
    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("@@")
    ) {
      // Process any collected lines before the new section
      if (inHunk) {
        processHunkLines();
        inHunk = false;
      }
      filtered.push(line);
      if (line.startsWith("@@")) {
        inHunk = true;
      }
      i++;
      continue;
    }

    // Handle context lines
    if (line.startsWith(" ")) {
      // Process any collected lines before the context
      processHunkLines();
      filtered.push(line);
      i++;
      continue;
    }

    // Handle special diff markers (e.g., "\ No newline at end of file")
    if (line.startsWith("\\")) {
      // Check if this is a line-ending-related marker
      if (line.includes("No newline at end of file")) {
        // Skip this marker as it's related to line endings
        i++;
        continue;
      }
      // Process collected lines and keep other backslash markers
      processHunkLines();
      filtered.push(line);
      i++;
      continue;
    }

    // Collect removed and added lines
    if (line.startsWith("-")) {
      removedLines.push({ index: i, content: line.substring(1) });
    } else if (line.startsWith("+")) {
      addedLines.push({ index: i, content: line.substring(1) });
    } else {
      // Unknown line type, process collected and keep this line
      processHunkLines();
      filtered.push(line);
    }

    i++;
  }

  // Process any remaining collected lines
  processHunkLines();

  return filtered;
}

/**
 * Post-process diff lines to combine consecutive old/new pairs that are identical after trimming
 * This helps reduce noise from whitespace-only changes
 */
export function combineIdenticalTrimmedLines(diffLines: string[]): string[] {
  const result: string[] = [];
  let i = 0;

  while (i < diffLines.length) {
    const line = diffLines[i];
    const nextLine = diffLines[i + 1];

    // Check if we have a consecutive old/new pair
    if (
      line &&
      nextLine &&
      line.startsWith("-") &&
      nextLine.startsWith("+") &&
      line.substring(1).trim() === nextLine.substring(1).trim()
    ) {
      // Replace the pair with a context line (using the original formatting from the old line)
      result.push(" " + line.substring(1));
      i += 2; // Skip both lines
    } else {
      // Keep the line as is
      result.push(line);
      i++;
    }
  }

  return result;
}

/**
 * Apply all line ending and whitespace filtering to a unified diff
 */
export function cleanDiff(unifiedDiff: string): string {
  if (!unifiedDiff || unifiedDiff.trim() === "") {
    return "";
  }

  // First, check if it's only line ending changes
  if (isOnlyLineEndingDiff(unifiedDiff)) {
    return "";
  }

  // Split into lines and apply filters
  const lines = unifiedDiff.split("\n");

  // Filter out line-ending-only changes
  let filteredLines = filterLineEndingOnlyChanges(lines);

  // Combine identical trimmed lines
  filteredLines = combineIdenticalTrimmedLines(filteredLines);

  // Check if we have any meaningful content left
  if (hasNoMeaningfulDiffContent(filteredLines.join("\n"))) {
    return "";
  }

  return filteredLines.join("\n");
}
