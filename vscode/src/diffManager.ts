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

    // Process diff lines and apply decorations
    // Key insight: diff lines represent changes to apply, decorations show where they go in current file
    let currentOriginalLine = startLine; // Track position in original content
    let currentDisplayLine = startLine; // Track position in current file for decorations
    let numRed = 0;
    let numGreen = 0;
    let blockStartLine = startLine;
    const codeLensBlocks: SimpleDiffCodeLens[] = [];

    console.log(`[DEBUG] Processing ${diffLines.length} diff lines starting at line ${startLine}`);

    diffLines.forEach((diffLine, index) => {
      console.log(
        `[DEBUG] Line ${index}: type=${diffLine.type}, originalLine=${currentOriginalLine}, displayLine=${currentDisplayLine}`,
      );

      if (diffLine.type === "old") {
        // Removed lines: show ghost text at current display position
        decorationManager.getRemovedDecorations()!.addLine(currentDisplayLine, diffLine.line);
        numRed++;
        currentOriginalLine++; // This line existed in original
        // Don't advance currentDisplayLine - removed lines don't take space in current file
      } else if (diffLine.type === "new") {
        // Added lines: show highlight at current display position
        decorationManager.getAddedDecorations()!.addLine(currentDisplayLine);
        numGreen++;
        currentDisplayLine++; // Added lines do take space in current file
        // Don't advance currentOriginalLine - this line didn't exist in original
      } else if (diffLine.type === "same") {
        // Same line: create block if we have changes, then advance both pointers
        if (numRed > 0 || numGreen > 0) {
          codeLensBlocks.push({
            start: blockStartLine,
            numAdded: numGreen,
            numRemoved: numRed,
          });

          console.log(
            `[DEBUG] Created CodeLens block: start=${blockStartLine}, added=${numGreen}, removed=${numRed}`,
          );

          // Reset for next block
          numRed = 0;
          numGreen = 0;
        }

        // Advance both pointers for same lines
        currentOriginalLine++;
        currentDisplayLine++;
        blockStartLine = currentDisplayLine;
      }
    });

    // Handle final block if we end on changes (no trailing "same" line)
    if (numRed > 0 || numGreen > 0) {
      codeLensBlocks.push({
        start: blockStartLine,
        numAdded: numGreen,
        numRemoved: numRed,
      });

      console.log(
        `[DEBUG] Created final CodeLens block: start=${blockStartLine}, added=${numGreen}, removed=${numRed}`,
      );
    }

    console.log(
      `[DEBUG] Applied ${numRed + numGreen} total decorations (${numRed} red, ${numGreen} green)`,
    );
    console.log(`[DEBUG] Created ${codeLensBlocks.length} CodeLens blocks`);

    // Store the decoration manager so it stays active
    this.fileUriToDecorationManager.set(fileUri, decorationManager);

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
