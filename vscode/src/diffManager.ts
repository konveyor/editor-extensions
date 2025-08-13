import * as vscode from "vscode";
import { DiffDecorationManager } from "./decorations";

export interface SimpleDiffCodeLens {
  start: number;
  numAdded: number;
  numRemoved: number;
}

export class SimpleDiffManager {
  // Shared map that CodeLens provider reads from
  public fileUriToCodeLens: Map<string, SimpleDiffCodeLens[]> = new Map();

  private fileUriToDecorationManager: Map<string, DiffDecorationManager> = new Map();

  public refreshCodeLens: () => void = () => {};

  constructor() {}

  setRefreshCodeLensCallback(callback: () => void) {
    this.refreshCodeLens = callback;
  }

  async showDiffWithDecorations(
    fileUri: string,
    startLine: number,
    endLine: number,
    diffLines: Array<{ type: string; line: string }>,
    messageToken: string,
    originalContent: string,
  ) {
    // Clear any existing diff for this file
    this.clearDiffForFile(fileUri);

    // Get the editor
    const uri = vscode.Uri.parse(fileUri);
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== fileUri) {
      throw new Error("No active editor for file");
    }

    // Create decoration manager
    const decorationManager = new DiffDecorationManager(fileUri);
    decorationManager.initializeForEditor(editor);
    this.fileUriToDecorationManager.set(fileUri, decorationManager);

    // Apply decorations using Continue's approach
    let numRed = 0;
    let numGreen = 0;
    const codeLensBlocks: SimpleDiffCodeLens[] = [];

    diffLines.forEach((diffLine, index) => {
      if (diffLine.type === "old") {
        // Use Continue's exact positioning: startLine + index
        decorationManager.getRemovedDecorations()!.addLine(startLine + index, diffLine.line);
        numRed++;
      } else if (diffLine.type === "new") {
        // Use Continue's exact positioning: startLine + index
        decorationManager.getAddedDecorations()!.addLine(startLine + index);
        numGreen++;
      } else if (diffLine.type === "same" && (numRed > 0 || numGreen > 0)) {
        // Create a diff block when we hit a "same" line after changes
        // Use Continue's exact positioning: startLine + index - numRed - numGreen
        const blockStartLine = startLine + index - numRed - numGreen;

        codeLensBlocks.push({
          start: blockStartLine,
          numAdded: numGreen,
          numRemoved: numRed,
        });

        console.log(
          `[DEBUG] Created CodeLens block: start=${blockStartLine}, added=${numGreen}, removed=${numRed}`,
        );

        // Reset counters
        numRed = 0;
        numGreen = 0;
      }
    });

    // Handle final block if we end on changes (no trailing "same" line)
    if (numRed > 0 || numGreen > 0) {
      const blockStartLine = startLine + diffLines.length - numRed - numGreen;

      codeLensBlocks.push({
        start: blockStartLine,
        numAdded: numGreen,
        numRemoved: numRed,
      });

      console.log(
        `[DEBUG] Created final CodeLens block: start=${blockStartLine}, added=${numGreen}, removed=${numRed}`,
      );
    }

    // Store CodeLens blocks in shared map
    this.fileUriToCodeLens.set(fileUri, codeLensBlocks);
    console.log(`[DEBUG] Stored ${codeLensBlocks.length} CodeLens blocks for ${fileUri}`);

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
      this.clearDiffForFile(targetFileUri);
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

    // Remove the accepted block from CodeLens
    blocks.splice(blockIndex, 1);
    this.fileUriToCodeLens.set(fileUri, blocks);

    // If no more blocks, clear everything
    if (blocks.length === 0) {
      this.clearDiffForFile(fileUri);
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

    // For now, just remove the block (later we can implement actual revert logic)
    blocks.splice(blockIndex, 1);
    this.fileUriToCodeLens.set(fileUri, blocks);

    // If no more blocks, clear everything
    if (blocks.length === 0) {
      this.clearDiffForFile(fileUri);
    } else {
      // Refresh CodeLens to show remaining blocks
      this.refreshCodeLens();
    }

    vscode.window.showInformationMessage(
      `Changes rejected for ${vscode.workspace.asRelativePath(vscode.Uri.parse(fileUri))}`,
    );
  }

  clearDiffForFile(fileUri: string) {
    // Clear CodeLens
    this.fileUriToCodeLens.delete(fileUri);

    // Clear decorations
    const decorationManager = this.fileUriToDecorationManager.get(fileUri);
    if (decorationManager) {
      decorationManager.dispose();
      this.fileUriToDecorationManager.delete(fileUri);
    }

    // Refresh CodeLens
    this.refreshCodeLens();
  }

  clearAllDiffs() {
    // Clear all CodeLens
    this.fileUriToCodeLens.clear();

    // Clear all decorations
    for (const [, manager] of this.fileUriToDecorationManager.entries()) {
      manager.dispose();
    }
    this.fileUriToDecorationManager.clear();

    // Refresh CodeLens
    this.refreshCodeLens();
  }
}
