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

  constructor(private fileUri: string) {}

  initializeForEditor(editor: vscode.TextEditor) {
    this.editor = editor;
    this.addedLineDecorations = new AddedLineDecorationManager(editor);
    this.removedLineDecorations = new RemovedLineDecorationManager(editor);
  }

  applyDiffDecorations(
    diffLines: Array<{ type: string; line: string; lineNumber: number }>,
    messageToken: string,
  ) {
    if (!this.editor || !this.addedLineDecorations || !this.removedLineDecorations) {
      throw new Error("Manager not initialized with editor");
    }

    // Clear existing decorations and diff blocks
    this.clearDecorations();
    this.diffBlocks = [];

    // Group consecutive lines by type
    let currentGroup: { type: string; lines: string[]; startLine: number } | null = null;

    for (const diffLine of diffLines) {
      if (!currentGroup || currentGroup.type !== diffLine.type) {
        // Apply previous group if it exists
        if (currentGroup) {
          this.applyGroup(currentGroup, messageToken);
        }
        // Start new group
        currentGroup = {
          type: diffLine.type,
          lines: [diffLine.line],
          startLine: diffLine.lineNumber,
        };
      } else {
        // Add to current group
        currentGroup.lines.push(diffLine.line);
      }
    }

    // Apply the last group
    if (currentGroup) {
      this.applyGroup(currentGroup, messageToken);
    }
  }

  getDiffBlocks(): DiffBlock[] {
    return this.diffBlocks;
  }

  private applyGroup(
    group: { type: string; lines: string[]; startLine: number },
    messageToken: string,
  ) {
    if (!this.addedLineDecorations || !this.removedLineDecorations) {
      return;
    }

    switch (group.type) {
      case "added":
        this.addedLineDecorations.addLines(group.startLine, group.lines.length);
        // Create diff block for CodeLens
        this.diffBlocks.push({
          startLine: group.startLine,
          numAdded: group.lines.length,
          numRemoved: 0,
          fileUri: this.fileUri,
          messageToken,
        });
        break;
      case "removed":
        this.removedLineDecorations.addLines(group.startLine, group.lines);
        // Create diff block for CodeLens
        this.diffBlocks.push({
          startLine: group.startLine,
          numAdded: 0,
          numRemoved: group.lines.length,
          fileUri: this.fileUri,
          messageToken,
        });
        break;
      // "same" lines don't need decorations or CodeLens
    }
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
