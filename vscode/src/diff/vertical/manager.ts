import { DiffLine, IDE } from "../types";
import * as URI from "uri-js";
import * as vscode from "vscode";
import { VerticalDiffHandler, VerticalDiffHandlerOptions } from "./handler";

export interface VerticalDiffCodeLens {
  start: number;
  numRed: number;
  numGreen: number;
}

export class VerticalDiffManager {
  public refreshCodeLens: () => void = () => {};
  public onDiffStatusChange: ((fileUri: string) => void) | undefined;

  private fileUriToHandler: Map<string, VerticalDiffHandler> = new Map();
  fileUriToCodeLens: Map<string, VerticalDiffCodeLens[]> = new Map();

  private userChangeListener: vscode.Disposable | undefined;

  logDiffs: DiffLine[] | undefined;

  constructor(private readonly ide: IDE) {
    this.userChangeListener = undefined;
  }

  createVerticalDiffHandler(
    fileUri: string,
    startLine: number,
    endLine: number,
    options: VerticalDiffHandlerOptions,
  ): VerticalDiffHandler | undefined {
    if (this.fileUriToHandler.has(fileUri)) {
      this.fileUriToHandler.get(fileUri)?.clear(false);
      this.fileUriToHandler.delete(fileUri);
    }
    const editor = vscode.window.activeTextEditor;
    if (editor && URI.equal(editor.document.uri.toString(), fileUri)) {
      const handler = new VerticalDiffHandler(
        startLine,
        endLine,
        editor,
        this.fileUriToCodeLens,
        this.clearForfileUri.bind(this),
        this.refreshCodeLens,
        options,
      );
      this.fileUriToHandler.set(fileUri, handler);
      return handler;
    } else {
      return undefined;
    }
  }

  getHandlerForFile(fileUri: string) {
    return this.fileUriToHandler.get(fileUri);
  }

  getStreamIdForFile(fileUri: string): string | undefined {
    return this.fileUriToHandler.get(fileUri)?.streamId;
  }

  // Creates a listener for document changes by user.
  private enableDocumentChangeListener(): vscode.Disposable | undefined {
    if (this.userChangeListener) {
      //Only create one listener per file
      return;
    }

    this.userChangeListener = vscode.workspace.onDidChangeTextDocument((event) => {
      // Check if there is an active handler for the affected file
      const fileUri = event.document.uri.toString();
      const handler = this.getHandlerForFile(fileUri);
      if (handler) {
        // If there is an active diff for that file, handle the document change
        this.handleDocumentChange(event, handler);
      }
    });
  }

  // Listener for user doc changes is disabled during updates to the text document by continue
  public disableDocumentChangeListener() {
    if (this.userChangeListener) {
      this.userChangeListener.dispose();
      this.userChangeListener = undefined;
    }
  }

  private handleDocumentChange(
    event: vscode.TextDocumentChangeEvent,
    handler: VerticalDiffHandler,
  ) {
    // Loop through each change in the event
    event.contentChanges.forEach((change) => {
      // Calculate the number of lines added or removed
      const linesAdded = change.text.split("\n").length - 1;
      const linesDeleted = change.range.end.line - change.range.start.line;

      // Calculate the net change in lines
      const lineDelta = linesAdded - linesDeleted;

      // Get the line number where the change occurred
      const lineNumber = change.range.start.line;

      // Update decorations based on the change
      // Note: updateDecorations method would need to be implemented in handler
      // For now, we'll just log the change
      console.log(`Document change at line ${lineNumber}, delta: ${lineDelta}`);
    });
  }

  async acceptRejectVerticalDiffBlock(accept: boolean, fileUri?: string, index?: number) {
    if (!fileUri) {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        return;
      }
      fileUri = activeEditor.document.uri.toString();
    }

    const handler = this.fileUriToHandler.get(fileUri);
    if (!handler) {
      console.warn(`No handler found for file: ${fileUri}`);
      return;
    }

    const blocks = this.fileUriToCodeLens.get(fileUri);
    if (!blocks) {
      console.warn(`No code lens blocks found for file: ${fileUri}`);
      return;
    }

    const block = index !== undefined ? blocks[index] : blocks[0];
    if (!block) {
      console.warn(`Block at index ${index} not found`);
      return;
    }

    await handler.acceptRejectBlock(accept, block.start, block.numGreen, block.numRed);

    if (blocks.length === 1) {
      this.clearForfileUri(fileUri, true);
    } else {
      // Re-enable listener for user changes to file
      this.enableDocumentChangeListener();
    }

    this.refreshCodeLens();

    // Notify status change
    if (this.onDiffStatusChange) {
      this.onDiffStatusChange(fileUri);
    }
  }

  clearForfileUri(fileUri: string | undefined, accept: boolean = false) {
    if (!fileUri) {
      return;
    }

    const handler = this.fileUriToHandler.get(fileUri);
    if (handler) {
      handler.clear(accept);
      this.fileUriToHandler.delete(fileUri);
    }

    this.disableDocumentChangeListener();

    this.fileUriToCodeLens.delete(fileUri);
    this.refreshCodeLens();

    void vscode.commands.executeCommand("setContext", "konveyor.diffVisible", false);

    // Notify status change
    if (this.onDiffStatusChange) {
      this.onDiffStatusChange(fileUri);
    }
  }

  /**
   * Simplified method for streaming diff lines for static diffs
   */
  async streamDiffLines(
    diffStream: AsyncGenerator<DiffLine>,
    instant: boolean = true,
    streamId?: string,
    toolCallId?: string,
  ) {
    console.log(`[Manager] streamDiffLines called - instant: ${instant}, streamId: ${streamId}`);
    void vscode.commands.executeCommand("setContext", "konveyor.diffVisible", true);

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      console.warn("[Manager] No active editor");
      return;
    }

    const fileUri = editor.document.uri.toString();
    console.log(`[Manager] Working with file: ${fileUri}`);

    const startLine = editor.selection.start.line;
    const endLine = editor.selection.end.line;
    console.log(`[Manager] Selection range: ${startLine}-${endLine}`);

    // Clear any existing handler
    const existingHandler = this.getHandlerForFile(fileUri);
    if (existingHandler) {
      console.log("[Manager] Clearing existing handler");
      await existingHandler.clear(false);
    }

    // Small delay to ensure UI updates
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Create new handler
    console.log("[Manager] Creating new vertical diff handler");
    const diffHandler = this.createVerticalDiffHandler(fileUri, startLine, endLine, {
      instant,
      onStatusUpdate: (status, numDiffs, fileContent) => {
        console.log(`[Manager] Status update: ${status}, numDiffs: ${numDiffs}`);
      },
      streamId,
      onDiffStatusChange: (fileUri) => {
        if (this.onDiffStatusChange) {
          this.onDiffStatusChange(fileUri);
        }
      },
    });

    if (!diffHandler) {
      console.warn("[Manager] Failed to create vertical diff handler");
      return;
    }

    void vscode.commands.executeCommand("setContext", "konveyor.streamingDiff", true);

    try {
      console.log("[Manager] Starting diff handler.run()");
      this.logDiffs = await diffHandler.run(diffStream);
      console.log(`[Manager] Diff handler completed, logDiffs: ${this.logDiffs?.length}`);

      // Enable listener for user edits to file while diff is open
      this.enableDocumentChangeListener();
    } catch (e) {
      console.error("[Manager] Error in streamDiffLines:", e);
      this.disableDocumentChangeListener();
      throw e;
    } finally {
      void vscode.commands.executeCommand("setContext", "konveyor.streamingDiff", false);
    }
  }

  // Accept all changes in the current file
  async acceptAll(fileUri?: string) {
    if (!fileUri) {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        return;
      }
      fileUri = activeEditor.document.uri.toString();
    }

    const handler = this.fileUriToHandler.get(fileUri);
    if (handler) {
      // Accept all blocks
      const blocks = this.fileUriToCodeLens.get(fileUri);
      if (blocks) {
        for (const block of blocks) {
          await handler.acceptRejectBlock(true, block.start, block.numGreen, block.numRed);
        }
      }
      this.clearForfileUri(fileUri, true);
    }
  }

  // Reject all changes in the current file
  async rejectAll(fileUri?: string) {
    if (!fileUri) {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        return;
      }
      fileUri = activeEditor.document.uri.toString();
    }

    const handler = this.fileUriToHandler.get(fileUri);
    if (handler) {
      // Reject all blocks
      const blocks = this.fileUriToCodeLens.get(fileUri);
      if (blocks) {
        for (const block of blocks) {
          await handler.acceptRejectBlock(false, block.start, block.numGreen, block.numRed);
        }
      }
      this.clearForfileUri(fileUri, false);
    }
  }
}
