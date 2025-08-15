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

export class StreamingDiffHandler {
  private editor: vscode.TextEditor;
  private fileUri: string;
  public decorationManager: DiffDecorationManager; // Make public for cleanup access
  private diffBlocks: SimpleDiffCodeLens[] = [];
  private currentBlock: { startLine: number; numAdded: number; numRemoved: number } | null = null;
  private currentLine = 0;
  private documentChangeListener: vscode.Disposable | null = null;

  constructor(
    editor: vscode.TextEditor,
    fileUri: string,
    decorationManager: DiffDecorationManager,
  ) {
    this.editor = editor;
    this.fileUri = fileUri;
    this.decorationManager = decorationManager;
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

  async streamDiffLine(diffLine: DiffLine): Promise<void> {
    if (diffLine.type === "old") {
      // Removed line: add ghost text decoration
      this.decorationManager.getRemovedDecorations()?.addLine(this.currentLine, diffLine.line);

      if (!this.currentBlock) {
        this.currentBlock = { startLine: this.currentLine, numAdded: 0, numRemoved: 0 };
      }
      this.currentBlock.numRemoved++;

      // Don't advance currentLine for removed lines
    } else if (diffLine.type === "new") {
      // Added line: add highlight decoration
      this.decorationManager.getAddedDecorations()?.addLine(this.currentLine);

      if (!this.currentBlock) {
        this.currentBlock = { startLine: this.currentLine, numAdded: 0, numRemoved: 0 };
      }
      this.currentBlock.numAdded++;

      this.currentLine++; // Added lines advance the current position
    } else if (diffLine.type === "same") {
      // Same line: finalize current block if exists
      if (
        this.currentBlock &&
        (this.currentBlock.numAdded > 0 || this.currentBlock.numRemoved > 0)
      ) {
        this.diffBlocks.push({
          start: this.currentBlock.startLine,
          numAdded: this.currentBlock.numAdded,
          numRemoved: this.currentBlock.numRemoved,
        });
        this.currentBlock = null;
      }

      this.currentLine++; // Same lines advance the current position
    }
  }

  finalizeDiff(): SimpleDiffCodeLens[] {
    // Handle final block if we end on changes
    if (this.currentBlock && (this.currentBlock.numAdded > 0 || this.currentBlock.numRemoved > 0)) {
      this.diffBlocks.push({
        start: this.currentBlock.startLine,
        numAdded: this.currentBlock.numAdded,
        numRemoved: this.currentBlock.numRemoved,
      });
    }

    return this.diffBlocks;
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
    // Clear any existing diff for this file
    this.clearForFileUri(fileUri);

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

    // Create decoration manager
    const decorationManager = new DiffDecorationManager(fileUri);
    decorationManager.initializeForEditor(editor);

    // Create streaming handler
    const handler = new StreamingDiffHandler(editor, fileUri, decorationManager);
    this.fileUriToHandler.set(fileUri, handler);

    return handler;
  }

  async streamDiffLines(fileUri: string, diffLines: AsyncIterable<DiffLine>): Promise<void> {
    const handler = this.fileUriToHandler.get(fileUri);
    if (!handler) {
      throw new Error(`No streaming diff handler found for ${fileUri}`);
    }

    // Process each diff line as it arrives
    for await (const diffLine of diffLines) {
      await handler.streamDiffLine(diffLine);
    }

    // Finalize and store the results
    const codeLensBlocks = handler.finalizeDiff();
    this.fileUriToCodeLens.set(fileUri, codeLensBlocks);

    // Refresh CodeLens
    this.refreshCodeLens();
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
    // Convert to streaming format
    const streamingDiffLines = diffLines.map((line) => ({
      type: line.type as "old" | "new" | "same",
      line: line.line,
    }));

    // Start streaming diff
    const handler = await this.startStreamingDiff(fileUri, startLine);

    // Process all lines at once (simulating streaming)
    for (const diffLine of streamingDiffLines) {
      await handler.streamDiffLine(diffLine);
    }

    // Finalize and store the results
    const codeLensBlocks = handler.finalizeDiff();
    this.fileUriToCodeLens.set(fileUri, codeLensBlocks);

    console.log(`[DEBUG] Processed ${diffLines.length} diff lines starting at line ${startLine}`);
    console.log(`[DEBUG] Created ${codeLensBlocks.length} CodeLens blocks`);

    // Refresh CodeLens
    this.refreshCodeLens();
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
