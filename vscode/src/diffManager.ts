import * as vscode from "vscode";
import { DiffDecorationManager } from "./decorations";

export interface SimpleDiffCodeLens {
  start: number;
  numAdded: number;
  numRemoved: number;
}

export interface DiffLine {
  type: "old" | "new" | "same";
  line: string;
}

// Utility functions for content normalization and diff handling
export class DiffUtils {
  /**
   * Normalize content for comparison (handle line endings and whitespace)
   * Similar to myers.ts approach but preserves original content structure
   */
  static normalizeContent(text: string): string {
    return text.replace(/\r\n/g, "\n");
  }

  /**
   * Check if two contents are equivalent after normalization
   * Handles edge cases like trailing newlines and whitespace differences
   */
  static contentsAreEquivalent(content1: string, content2: string): boolean {
    const normalized1 = this.normalizeContent(content1);
    const normalized2 = this.normalizeContent(content2);

    // Handle trailing newline differences (like myers.ts does)
    const trimmed1 = normalized1.endsWith("\n") ? normalized1.slice(0, -1) : normalized1;
    const trimmed2 = normalized2.endsWith("\n") ? normalized2.slice(0, -1) : normalized2;

    return trimmed1 === trimmed2;
  }

  /**
   * Validate diff structure and content
   * Ensures diff can be safely applied
   */
  static validateDiff(
    diffLines: DiffLine[],
    originalContent: string,
  ): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!Array.isArray(diffLines) || diffLines.length === 0) {
      errors.push("Diff lines must be a non-empty array");
      return { isValid: false, errors, warnings };
    }

    const originalLines = originalContent.split("\n");
    let lineIndex = 0;

    for (let i = 0; i < diffLines.length; i++) {
      const diffLine = diffLines[i];

      if (!diffLine || typeof diffLine.type !== "string" || typeof diffLine.line !== "string") {
        errors.push(`Invalid diff line at index ${i}`);
        continue;
      }

      if (!["old", "new", "same"].includes(diffLine.type)) {
        errors.push(`Unknown diff line type '${diffLine.type}' at index ${i}`);
        continue;
      }

      if (diffLine.type === "old" || diffLine.type === "same") {
        if (lineIndex >= originalLines.length) {
          errors.push(
            `Diff references line ${lineIndex + 1} but original content only has ${originalLines.length} lines`,
          );
        } else if (diffLine.type === "old" && diffLine.line !== originalLines[lineIndex]) {
          warnings.push(
            `Old line at index ${i} doesn't match original content at line ${lineIndex + 1}`,
          );
        }
        lineIndex++;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Reconstruct content from diff lines
   * Useful for validation and testing
   */
  static reconstructContent(diffLines: DiffLine[], originalContent: string): string {
    const originalLines = originalContent.split("\n");
    const reconstructedLines: string[] = [];
    let lineIndex = 0;

    for (const diffLine of diffLines) {
      if (diffLine.type === "same" || diffLine.type === "old") {
        if (lineIndex < originalLines.length) {
          reconstructedLines.push(originalLines[lineIndex]);
          lineIndex++;
        }
      } else if (diffLine.type === "new") {
        reconstructedLines.push(diffLine.line);
      }
    }

    return reconstructedLines.join("\n");
  }
}

export class StreamingDiffHandler {
  private editor: vscode.TextEditor;
  private fileUri: string;
  public decorationManager: DiffDecorationManager; // Make public for cleanup access
  private diffBlocks: SimpleDiffCodeLens[] = [];
  private documentChangeListener: vscode.Disposable | null = null;
  private originalContent: string = ""; // Store original content for validation

  // Indexing state following Continue's approach
  private baseStartLine: number;
  private currentIndex: number = 0; // Increments for every diff line processed
  private numAddedInRun: number = 0;
  private numRemovedInRun: number = 0;

  constructor(
    editor: vscode.TextEditor,
    fileUri: string,
    decorationManager: DiffDecorationManager,
    startLine: number = 0,
  ) {
    this.editor = editor;
    this.fileUri = fileUri;
    this.decorationManager = decorationManager;
    this.originalContent = editor.document.getText();
    this.baseStartLine = startLine;
    this.setupDocumentChangeListener();
  }

  private setupDocumentChangeListener() {
    this.documentChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === this.fileUri) {
        // Update decoration ranges if user edits the document while diff is active
        for (const change of event.contentChanges) {
          const lineOffset = change.range.start.line;
          const lineDelta =
            change.text.split("\n").length - 1 - (change.range.end.line - change.range.start.line);

          if (lineDelta !== 0) {
            // Adjust all decorations below the edit
            this.decorationManager
              .getRemovedDecorations()
              ?.shiftDownAfterLine(lineOffset, lineDelta);
            this.decorationManager.getAddedDecorations()?.shiftDownAfterLine(lineOffset, lineDelta);
          }
        }
      }
    });
  }

  // Validate that diff can be applied to current content
  private validateDiffApplication(diffLines: DiffLine[]): boolean {
    try {
      // Use the utility class for validation
      const validation = DiffUtils.validateDiff(diffLines, this.originalContent);

      if (!validation.isValid) {
        console.warn("Diff validation failed:", validation.errors);
        return false;
      }

      if (validation.warnings.length > 0) {
        console.warn("Diff validation warnings:", validation.warnings);
      }

      return true;
    } catch (error) {
      console.warn("Diff validation failed:", error);
      return false;
    }
  }

  // Normalize content for comparison (handle line endings and whitespace)
  private normalizeContent(text: string): string {
    return DiffUtils.normalizeContent(text);
  }

  async streamDiffLine(diffLine: DiffLine): Promise<void> {
    // Validate the diff line
    if (!diffLine || typeof diffLine.type !== "string" || typeof diffLine.line !== "string") {
      console.warn("Invalid diff line received:", diffLine);
      return;
    }

    const targetLine = this.baseStartLine + this.currentIndex;

    if (diffLine.type === "old") {
      // Removed line: add ghost text decoration at the indexed line
      this.decorationManager.getRemovedDecorations()?.addLine(targetLine, diffLine.line);
      this.numRemovedInRun++;
      this.currentIndex++; // Advance index for every diff line processed
    } else if (diffLine.type === "new") {
      // Added line: add highlight decoration and ghost text at the indexed line
      this.decorationManager.getAddedDecorations()?.addLine(targetLine);
      // If available, also render ghost text for the added content so it's visible pre-apply
      // Note: method exposed via DiffDecorationManager
      (this.decorationManager as any)
        .getAddedGhostDecorations?.()
        ?.addLine(targetLine, diffLine.line);
      this.numAddedInRun++;
      this.currentIndex++; // Advance index
    } else if (diffLine.type === "same") {
      // Same line: finalize current block if exists
      if (this.numAddedInRun > 0 || this.numRemovedInRun > 0) {
        this.diffBlocks.push({
          start: this.baseStartLine + this.currentIndex - this.numAddedInRun - this.numRemovedInRun,
          numAdded: this.numAddedInRun,
          numRemoved: this.numRemovedInRun,
        });
        this.numAddedInRun = 0;
        this.numRemovedInRun = 0;
      }
      this.currentIndex++; // Advance index
    } else {
      console.warn("Unknown diff line type:", diffLine.type);
    }
  }

  // Process multiple diff lines with validation
  async processDiffLines(diffLines: DiffLine[]): Promise<void> {
    // Validate the entire diff before processing
    if (!this.validateDiffApplication(diffLines)) {
      console.warn("Diff validation failed, attempting to process anyway");
    }

    // Process each line
    for (const diffLine of diffLines) {
      await this.streamDiffLine(diffLine);
    }
  }

  finalizeDiff(): SimpleDiffCodeLens[] {
    // Handle final block if we end on changes
    if (this.numAddedInRun > 0 || this.numRemovedInRun > 0) {
      this.diffBlocks.push({
        start: this.baseStartLine + this.currentIndex - this.numAddedInRun - this.numRemovedInRun,
        numAdded: this.numAddedInRun,
        numRemoved: this.numRemovedInRun,
      });
      this.numAddedInRun = 0;
      this.numRemovedInRun = 0;
    }

    // Validate final blocks
    const validatedBlocks = this.diffBlocks.filter(
      (block) =>
        block.start >= 0 &&
        block.numAdded >= 0 &&
        block.numRemoved >= 0 &&
        block.start + Math.max(block.numAdded, block.numRemoved) <= this.editor.document.lineCount,
    );

    if (validatedBlocks.length !== this.diffBlocks.length) {
      console.warn(
        `Filtered ${this.diffBlocks.length - validatedBlocks.length} invalid diff blocks`,
      );
    }

    return validatedBlocks;
  }

  dispose() {
    this.documentChangeListener?.dispose();
    this.decorationManager.dispose();
  }

  getDiffBlocks(): SimpleDiffCodeLens[] {
    return this.diffBlocks;
  }
}

export class SimpleDiffManager {
  // Shared map that CodeLens provider reads from
  public fileUriToCodeLens: Map<string, SimpleDiffCodeLens[]> = new Map();

  public fileUriToHandler: Map<string, StreamingDiffHandler> = new Map(); // Make public for external access

  public refreshCodeLens: () => void = () => {};

  constructor() {}

  setRefreshCodeLensCallback(callback: () => void) {
    this.refreshCodeLens = callback;
  }

  // Method to get active streaming handlers (for debugging)
  getActiveHandlers(): string[] {
    return Array.from(this.fileUriToHandler.keys());
  }

  // Method to check if a file has an active diff
  hasActiveDiff(fileUri: string): boolean {
    return this.fileUriToHandler.has(fileUri);
  }

  async startStreamingDiff(fileUri: string, startLine: number = 0): Promise<StreamingDiffHandler> {
    try {
      // Clear any existing diff for this file
      this.clearForFileUri(fileUri);

      // Validate file URI
      if (!fileUri || typeof fileUri !== "string") {
        throw new Error("Invalid file URI provided");
      }

      // Get the editor - open the document first if needed
      const uri = vscode.Uri.parse(fileUri);
      let editor = vscode.window.activeTextEditor;

      // If no active editor or wrong file, open the correct file
      if (!editor || editor.document.uri.toString() !== fileUri) {
        const document = await vscode.workspace.openTextDocument(uri);
        editor = await vscode.window.showTextDocument(document, {
          viewColumn: vscode.ViewColumn.Two,
          preview: false,
          preserveFocus: true,
        });
      }

      // Validate that we have a valid editor
      if (!editor || !editor.document) {
        throw new Error("Failed to get valid editor for file");
      }

      // Create decoration manager
      const decorationManager = new DiffDecorationManager(fileUri);
      decorationManager.initializeForEditor(editor);

      // Create streaming handler with startLine
      const handler = new StreamingDiffHandler(editor, fileUri, decorationManager, startLine);
      this.fileUriToHandler.set(fileUri, handler);

      return handler;
    } catch (error) {
      console.error("Failed to start streaming diff:", error);
      throw error;
    }
  }

  async streamDiffLines(fileUri: string, diffLines: AsyncIterable<DiffLine>): Promise<void> {
    const handler = this.fileUriToHandler.get(fileUri);
    if (!handler) {
      throw new Error(`No streaming diff handler found for ${fileUri}`);
    }

    try {
      // Process each diff line as it arrives
      for await (const diffLine of diffLines) {
        await handler.streamDiffLine(diffLine);
      }

      // Finalize and store the results
      const codeLensBlocks = handler.finalizeDiff();
      this.fileUriToCodeLens.set(fileUri, codeLensBlocks);

      // Refresh CodeLens
      this.refreshCodeLens();
    } catch (error) {
      console.error("Error streaming diff lines:", error);
      // Clean up on error
      this.clearForFileUri(fileUri);
      throw error;
    }
  }

  // Backward compatibility method for static diff processing
  async showDiffWithDecorations(
    fileUri: string,
    startLine: number,
    endLine: number,
    diffLines: Array<{ type: string; line: string }>,
    messageToken: string,
    originalContent: string,
  ) {
    try {
      // Validate inputs
      if (!fileUri || !diffLines || !Array.isArray(diffLines)) {
        throw new Error("Invalid parameters for showDiffWithDecorations");
      }

      // Convert to streaming format with validation
      const streamingDiffLines: DiffLine[] = diffLines
        .filter((line) => line && typeof line.type === "string" && typeof line.line === "string")
        .map((line) => ({
          type: line.type as "old" | "new" | "same",
          line: line.line,
        }));

      if (streamingDiffLines.length === 0) {
        console.warn("No valid diff lines found");
        return;
      }

      // Start streaming diff
      const handler = await this.startStreamingDiff(fileUri, startLine);

      // Process all lines at once (simulating streaming)
      await handler.processDiffLines(streamingDiffLines);

      // Finalize and store the results
      const codeLensBlocks = handler.finalizeDiff();
      this.fileUriToCodeLens.set(fileUri, codeLensBlocks);

      console.log(
        `[DEBUG] Processed ${streamingDiffLines.length} diff lines starting at line ${startLine}`,
      );
      console.log(`[DEBUG] Created ${codeLensBlocks.length} CodeLens blocks`);

      // Refresh CodeLens
      this.refreshCodeLens();
    } catch (error) {
      console.error("Error in showDiffWithDecorations:", error);
      // Clean up on error
      this.clearForFileUri(fileUri);
      throw error;
    }
  }

  async processDiff(
    action: "accept" | "reject",
    fileUri?: string,
    blockIndex?: number,
    streamId?: string,
    toolCallId?: string,
  ) {
    // Get current file if not provided
    let targetFileUri = fileUri;
    if (!targetFileUri) {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        console.warn("No file provided or current file open while attempting to resolve diff");
        return;
      }
      targetFileUri = activeEditor.document.uri.toString();
    }

    // Open the file
    await vscode.window.showTextDocument(vscode.Uri.parse(targetFileUri));

    if (typeof blockIndex !== "undefined") {
      // Handle specific block accept/reject
      if (action === "accept") {
        await this.acceptDiffBlock(targetFileUri, blockIndex);
      } else {
        await this.rejectDiffBlock(targetFileUri, blockIndex);
      }
    } else {
      // Handle entire file accept/reject
      this.clearForFileUri(targetFileUri);
    }

    // Save the file
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(targetFileUri));
    await document.save();

    console.log(`[DEBUG] Processed ${action} diff for ${targetFileUri}`);
  }

  async acceptDiffBlock(fileUri: string, blockIndex: number) {
    const blocks = this.fileUriToCodeLens.get(fileUri);
    const block = blocks?.[blockIndex];

    if (!blocks || !block) {
      console.warn("No diff block found", { fileUri, blockIndex });
      return;
    }

    console.log(`[DEBUG] Accepting block ${blockIndex} for ${fileUri}`);

    // Get the handler to clean up decorations for this block
    const handler = this.fileUriToHandler.get(fileUri);
    if (handler) {
      // Remove decorations for accepted lines
      const addedDecorations = handler.decorationManager.getAddedDecorations();
      const removedDecorations = handler.decorationManager.getRemovedDecorations();

      // Clear decorations in the range of this block
      for (let i = 0; i < block.numAdded; i++) {
        addedDecorations?.deleteRangeStartingAt(block.start + i);
      }
      for (let i = 0; i < block.numRemoved; i++) {
        removedDecorations?.deleteRangesStartingAt(block.start);
      }
    }

    // Remove the accepted block from CodeLens
    blocks.splice(blockIndex, 1);
    this.fileUriToCodeLens.set(fileUri, blocks);

    // If no more blocks, clear everything
    if (blocks.length === 0) {
      this.clearForFileUri(fileUri);
    } else {
      // Refresh CodeLens to show remaining blocks
      this.refreshCodeLens();
    }

    vscode.window.showInformationMessage(
      `Changes accepted for ${vscode.workspace.asRelativePath(vscode.Uri.parse(fileUri))}`,
    );
  }

  async rejectDiffBlock(fileUri: string, blockIndex: number) {
    const blocks = this.fileUriToCodeLens.get(fileUri);
    const block = blocks?.[blockIndex];

    if (!blocks || !block) {
      console.warn("No diff block found", { fileUri, blockIndex });
      return;
    }

    console.log(`[DEBUG] Rejecting block ${blockIndex} for ${fileUri}`);

    // Get the handler to clean up decorations for this block
    const handler = this.fileUriToHandler.get(fileUri);
    if (handler) {
      // Remove decorations for rejected lines
      const addedDecorations = handler.decorationManager.getAddedDecorations();
      const removedDecorations = handler.decorationManager.getRemovedDecorations();

      // Clear decorations in the range of this block
      for (let i = 0; i < block.numAdded; i++) {
        addedDecorations?.deleteRangeStartingAt(block.start + i);
      }
      for (let i = 0; i < block.numRemoved; i++) {
        removedDecorations?.deleteRangesStartingAt(block.start);
      }
    }

    // Remove the rejected block from CodeLens
    blocks.splice(blockIndex, 1);
    this.fileUriToCodeLens.set(fileUri, blocks);

    // If no more blocks, clear everything
    if (blocks.length === 0) {
      this.clearForFileUri(fileUri);
    } else {
      // Refresh CodeLens to show remaining blocks
      this.refreshCodeLens();
    }

    vscode.window.showInformationMessage(
      `Changes rejected for ${vscode.workspace.asRelativePath(vscode.Uri.parse(fileUri))}`,
    );
  }

  clearForFileUri(fileUri: string) {
    // Clear CodeLens
    this.fileUriToCodeLens.delete(fileUri);

    // Dispose streaming handler
    const handler = this.fileUriToHandler.get(fileUri);
    if (handler) {
      handler.dispose();
      this.fileUriToHandler.delete(fileUri);
    }

    // Clear VS Code context
    vscode.commands.executeCommand("setContext", "konveyor.streamingDiff", false);

    // Refresh CodeLens
    this.refreshCodeLens();
  }

  // Backward compatibility alias
  clearDiffForFile(fileUri: string) {
    this.clearForFileUri(fileUri);
  }

  clearAllDiffs() {
    // Clear all CodeLens
    this.fileUriToCodeLens.clear();

    // Dispose all streaming handlers
    for (const [, handler] of this.fileUriToHandler.entries()) {
      handler.dispose();
    }
    this.fileUriToHandler.clear();

    // Clear VS Code context
    vscode.commands.executeCommand("setContext", "konveyor.streamingDiff", false);

    // Refresh CodeLens
    this.refreshCodeLens();
  }
}
