import * as vscode from "vscode";
import { DiffBlock } from "./diffCodeLensProvider";

const removedLineDecorationType = (line: string) =>
  vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: { id: "diffEditor.removedLineBackground" },
    outlineWidth: "1px",
    outlineStyle: "solid",
    outlineColor: { id: "diffEditor.removedTextBorder" },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    after: {
      contentText: line,
      color: "#808080",
      textDecoration: "none; white-space: pre",
    },
    // Hide the actual text to show only ghost text
    textDecoration: "none; display: none",
  });

const addedLineDecorationType = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: { id: "diffEditor.insertedLineBackground" },
  outlineWidth: "1px",
  outlineStyle: "solid",
  outlineColor: { id: "diffEditor.insertedTextBorder" },
  rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
});

function translateRange(range: vscode.Range, lineOffset: number): vscode.Range {
  return new vscode.Range(range.start.translate(lineOffset), range.end.translate(lineOffset));
}

// Class for managing highlight decorations for added lines (GREEN)
export class AddedLineDecorationManager {
  constructor(private editor: vscode.TextEditor) {}

  ranges: vscode.Range[] = [];
  decorationType = addedLineDecorationType;

  applyToNewEditor(newEditor: vscode.TextEditor) {
    this.editor = newEditor;
    this.editor.setDecorations(this.decorationType, this.ranges);
  }

  addLines(startIndex: number, numLines: number) {
    const lastRange = this.ranges[this.ranges.length - 1];
    if (lastRange && lastRange.end.line === startIndex - 1) {
      this.ranges[this.ranges.length - 1] = lastRange.with(
        undefined,
        lastRange.end.translate(numLines),
      );
    } else {
      this.ranges.push(
        new vscode.Range(startIndex, 0, startIndex + numLines - 1, Number.MAX_SAFE_INTEGER),
      );
    }

    this.editor.setDecorations(this.decorationType, this.ranges);
  }

  addLine(index: number) {
    this.addLines(index, 1);
  }

  clear() {
    this.ranges = [];
    this.editor.setDecorations(this.decorationType, this.ranges);
  }

  shiftDownAfterLine(afterLine: number, offset: number) {
    for (let i = 0; i < this.ranges.length; i++) {
      if (this.ranges[i].start.line >= afterLine) {
        this.ranges[i] = translateRange(this.ranges[i], offset);
      }
    }
    this.editor.setDecorations(this.decorationType, this.ranges);
  }

  deleteRangeStartingAt(line: number) {
    for (let i = 0; i < this.ranges.length; i++) {
      if (this.ranges[i].start.line === line) {
        return this.ranges.splice(i, 1)[0];
      }
    }
    this.editor.setDecorations(this.decorationType, this.ranges);
  }
}

// Class for managing ghost-text decorations for removed lines (RED)
export class RemovedLineDecorationManager {
  constructor(private editor: vscode.TextEditor) {}

  ranges: {
    line: string;
    range: vscode.Range;
    decoration: vscode.TextEditorDecorationType;
  }[] = [];

  applyToNewEditor(newEditor: vscode.TextEditor) {
    this.editor = newEditor;
    this.applyDecorations();
  }

  addLines(startIndex: number, lines: string[]) {
    let i = 0;
    for (const line of lines) {
      this.ranges.push({
        line,
        range: new vscode.Range(startIndex + i, 0, startIndex + i, Number.MAX_SAFE_INTEGER),
        decoration: removedLineDecorationType(line),
      });
      i++;
    }
    this.applyDecorations();
  }

  addLine(index: number, line: string) {
    this.addLines(index, [line]);
  }

  applyDecorations() {
    this.ranges.forEach((r) => {
      this.editor.setDecorations(r.decoration, [r.range]);
    });
  }

  // Removed decorations are always unique, so we'll always dispose
  clear() {
    this.ranges.forEach((r) => {
      r.decoration.dispose();
    });
    this.ranges = [];
  }

  shiftDownAfterLine(afterLine: number, offset: number) {
    for (let i = 0; i < this.ranges.length; i++) {
      if (this.ranges[i].range.start.line >= afterLine) {
        this.ranges[i].range = translateRange(this.ranges[i].range, offset);
      }
    }
    this.applyDecorations();
  }

  deleteRangesStartingAt(line: number) {
    for (let i = 0; i < this.ranges.length; i++) {
      if (this.ranges[i].range.start.line === line) {
        let sequential = 0;
        while (
          i + sequential < this.ranges.length &&
          this.ranges[i + sequential].range.start.line === line + sequential
        ) {
          this.ranges[i + sequential].decoration.dispose();
          sequential++;
        }
        return this.ranges.splice(i, sequential);
      }
    }
  }
}

// Manager to handle decorations for a file
export class DiffDecorationManager {
  private addedLineDecorations: AddedLineDecorationManager | null = null;
  private removedLineDecorations: RemovedLineDecorationManager | null = null;
  private editor: vscode.TextEditor | null = null;
  private diffBlocks: DiffBlock[] = [];
  private originalContent: string = "";

  constructor(private fileUri: string) {}

  initializeForEditor(editor: vscode.TextEditor) {
    this.editor = editor;
    this.addedLineDecorations = new AddedLineDecorationManager(editor);
    this.removedLineDecorations = new RemovedLineDecorationManager(editor);
  }

  applyDiffDecorationsWithRange(
    diffLines: Array<{ type: string; line: string }>,
    messageToken: string,
    originalContent: string,
    startLine: number,
  ) {
    if (!this.editor || !this.addedLineDecorations || !this.removedLineDecorations) {
      throw new Error("Manager not initialized with editor");
    }

    // Clear existing decorations and diff blocks
    this.clearDecorations();
    this.diffBlocks = [];
    this.originalContent = originalContent;

    // Follow Continue's exact approach from reapplyWithMyersDiff
    let numRed = 0;
    let numGreen = 0;

    const codeLensBlocks: DiffBlock[] = [];

    diffLines.forEach((diffLine, index) => {
      if (diffLine.type === "old") {
        // Use Continue's exact positioning: startLine + index
        this.removedLineDecorations!.addLine(startLine + index, diffLine.line);
        numRed++;
      } else if (diffLine.type === "new") {
        // Use Continue's exact positioning: startLine + index
        this.addedLineDecorations!.addLine(startLine + index);
        numGreen++;
      } else if (diffLine.type === "same" && (numRed > 0 || numGreen > 0)) {
        // Create a diff block when we hit a "same" line after changes
        // Use Continue's exact positioning: startLine + index - numRed - numGreen
        const blockStartLine = startLine + index - numRed - numGreen;

        const newBlock: DiffBlock = {
          startLine: blockStartLine,
          numAdded: numGreen,
          numRemoved: numRed,
          fileUri: this.fileUri,
          messageToken,
        };

        console.log(`[DEBUG] Creating diff block at same line:`, newBlock);
        codeLensBlocks.push(newBlock);

        // Reset counters
        numRed = 0;
        numGreen = 0;
      }
    });

    // Handle final block if we end on changes (no trailing "same" line)
    if (numRed > 0 || numGreen > 0) {
      // Use Continue's exact positioning: startLine + diffLines.length - numRed - numGreen
      const blockStartLine = startLine + diffLines.length - numRed - numGreen;

      const newBlock: DiffBlock = {
        startLine: blockStartLine,
        numAdded: numGreen,
        numRemoved: numRed,
        fileUri: this.fileUri,
        messageToken,
      };

      console.log(`[DEBUG] Creating final diff block:`, newBlock);
      codeLensBlocks.push(newBlock);
    }

    this.diffBlocks = codeLensBlocks;
  }

  // Keep the old method for backward compatibility
  applyDiffDecorations(
    diffLines: Array<{ type: string; line: string; lineNumber: number }>,
    messageToken: string,
    originalContent: string,
  ) {
    // Convert to new format and call new method with startLine = 0
    const convertedLines = diffLines.map((line) => ({
      type: line.type === "added" ? "new" : line.type === "removed" ? "old" : "same",
      line: line.line,
    }));
    this.applyDiffDecorationsWithRange(convertedLines, messageToken, originalContent, 0);
  }

  getDiffBlocks(): DiffBlock[] {
    return this.diffBlocks;
  }

  getOriginalContent(): string {
    return this.originalContent;
  }

  // Expose decoration managers for direct access
  getRemovedDecorations(): RemovedLineDecorationManager | null {
    return this.removedLineDecorations;
  }

  getAddedDecorations(): AddedLineDecorationManager | null {
    return this.addedLineDecorations;
  }

  clearDecorations() {
    this.addedLineDecorations?.clear();
    this.removedLineDecorations?.clear();
  }

  dispose() {
    this.clearDecorations();
    this.addedLineDecorations = null;
    this.removedLineDecorations = null;
    this.editor = null;
  }
}
