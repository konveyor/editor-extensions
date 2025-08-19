import * as vscode from "vscode";
import { DiffLine } from "./types";
import { VerticalDiffManager } from "./vertical/manager";
import { parsePatch } from "diff";
import { Logger } from "winston";

/**
 * Adapter to bridge static diffs (from ModifiedFileMessage) to Continue's vertical diff system
 * This converts a complete unified diff into the streaming format that VerticalDiffHandler expects
 */
export class StaticDiffAdapter {
  constructor(
    private verticalDiffManager: VerticalDiffManager,
    private logger: Logger,
  ) {}

  /**
   * Parse unified diff into DiffLine array format
   */
  private parseUnifiedDiffToDiffLines(unifiedDiff: string, originalContent: string): DiffLine[] {
    const diffLines: DiffLine[] = [];
    const originalLines = originalContent.split("\n");

    // Parse the unified diff
    const parsedDiff = parsePatch(unifiedDiff);
    if (!parsedDiff || parsedDiff.length === 0) {
      throw new Error("Failed to parse diff");
    }

    // Track which original lines have been processed
    let originalLineIndex = 0;

    for (const fileDiff of parsedDiff) {
      if (!fileDiff.hunks) {
        continue;
      }

      for (const hunk of fileDiff.hunks) {
        // Add unchanged lines before this hunk
        const hunkStartLine = hunk.oldStart - 1; // Convert to 0-based

        while (originalLineIndex < hunkStartLine && originalLineIndex < originalLines.length) {
          diffLines.push({
            type: "same",
            line: originalLines[originalLineIndex],
          });
          originalLineIndex++;
        }

        // Process hunk lines
        for (const line of hunk.lines) {
          const lineType = line.charAt(0);
          const lineContent = line.substring(1);

          switch (lineType) {
            case "+":
              diffLines.push({ type: "new", line: lineContent });
              break;
            case "-":
              diffLines.push({ type: "old", line: lineContent });
              originalLineIndex++; // Move past the removed line in original
              break;
            case " ":
              diffLines.push({ type: "same", line: lineContent });
              originalLineIndex++;
              break;
            case "\\":
              // Special diff markers like "\ No newline at end of file"
              continue;
          }
        }
      }
    }

    // Add any remaining unchanged lines
    while (originalLineIndex < originalLines.length) {
      diffLines.push({
        type: "same",
        line: originalLines[originalLineIndex],
      });
      originalLineIndex++;
    }

    return diffLines;
  }

  /**
   * Convert static diff to async generator for streaming compatibility
   */
  private async *staticDiffToStream(diffLines: DiffLine[]): AsyncGenerator<DiffLine> {
    for (const line of diffLines) {
      yield line;
    }
  }

  /**
   * Apply a static diff using Continue's vertical diff system
   * This is the main integration point called from commands.ts
   */
  async applyStaticDiff(
    filePath: string,
    unifiedDiff: string,
    originalContent: string,
    messageToken: string,
  ): Promise<void> {
    try {
      // Convert unified diff to DiffLine array
      const diffLines = this.parseUnifiedDiffToDiffLines(unifiedDiff, originalContent);

      // Open the file and ensure it's the active editor
      const uri = vscode.Uri.file(filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Two,
        preview: false,
        preserveFocus: false, // Changed to false to ensure the editor becomes active
      });

      // Small delay to ensure editor is fully active
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Create a static stream from the diff lines
      const diffStream = this.staticDiffToStream(diffLines);

      // Use VerticalDiffManager to handle the diff
      // The streamId is the messageToken for tracking
      this.logger.debug("[StaticDiffAdapter] Starting streamDiffLines with", {
        filePath,
        messageToken,
        diffLinesCount: diffLines.length,
        activeEditor: vscode.window.activeTextEditor?.document.fileName,
      });

      await this.verticalDiffManager.streamDiffLines(diffStream, messageToken);

      this.logger.debug("[StaticDiffAdapter] streamDiffLines completed");
    } catch (error) {
      this.logger.error("Failed to apply static diff:", error);
      throw error;
    }
  }

  /**
   * Accept all changes in a file
   */
  async acceptAll(filePath: string): Promise<void> {
    const fileUri = vscode.Uri.file(filePath).toString();
    await this.verticalDiffManager.clearForFileUri(fileUri, true);
  }

  /**
   * Reject all changes in a file
   */
  async rejectAll(filePath: string): Promise<void> {
    const fileUri = vscode.Uri.file(filePath).toString();
    await this.verticalDiffManager.clearForFileUri(fileUri, false);
  }

  /**
   * Accept/reject a specific diff block
   */
  async acceptRejectBlock(filePath: string, blockIndex: number, accept: boolean): Promise<void> {
    const fileUri = vscode.Uri.file(filePath).toString();
    await this.verticalDiffManager.acceptRejectVerticalDiffBlock(accept, fileUri, blockIndex);
  }
}
