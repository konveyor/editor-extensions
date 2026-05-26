import { DiffLine } from "../types";
import * as URI from "uri-js";
import * as vscode from "vscode";
import { VerticalDiffHandler, VerticalDiffHandlerOptions } from "./handler";
import { fileUriToPath } from "../../utilities/pathUtils";
import { ExtensionState } from "../../extensionState";
import { FileEditor } from "../../utilities/ideUtils";
import { InMemoryCacheWithRevisions } from "@editor-extensions/agentic";
import { Logger } from "winston";
import { ExtensionData } from "@editor-extensions/shared";
import { Immutable } from "immer";
import { EXTENSION_NAME } from "../../utilities/constants";
export interface VerticalDiffCodeLens {
  start: number;
  numRed: number;
  numGreen: number;
}

export class VerticalDiffManager {
  public refreshCodeLens: () => void = () => {};
  public onDiffStatusChange: ((fileUri: string) => void) | undefined;
  public onAllBlocksResolved:
    | ((streamId: string, fileUri: string, fileContent: string, accepted: boolean) => void)
    | undefined;

  private fileUriToHandler: Map<string, VerticalDiffHandler> = new Map();
  fileUriToCodeLens: Map<string, VerticalDiffCodeLens[]> = new Map();
  private fileUriToStreamId: Map<string, string> = new Map();

  private userChangeListener: vscode.Disposable | undefined;
  private tabCloseListener: vscode.Disposable | undefined;

  logDiffs: DiffLine[] | undefined;

  private readonly logger: Logger;
  private readonly kaiFsCache: InMemoryCacheWithRevisions<string, string>;
  private readonly mutateDecorators: (
    recipe: (draft: ExtensionData) => void,
  ) => Immutable<ExtensionData>;

  constructor(
    private readonly fileEditor: FileEditor,
    extensionState: ExtensionState,
  ) {
    // Destructure the properties we need from extensionState
    const { logger, kaiFsCache, mutateDecorators } = extensionState;
    this.logger = logger;
    this.kaiFsCache = kaiFsCache;
    this.mutateDecorators = mutateDecorators;

    this.userChangeListener = undefined;

    // Listen for tab close events to clean up diff state.
    // When the user closes a tab with active diff decorations without
    // accepting/rejecting, handler.clear() does editor edits to undo the
    // diff — but those edits silently fail because the editor is gone.
    // This leaves VS Code's in-memory buffer dirty with patched content
    // (even though git status shows clean). The only workaround was to
    // reopen VS Code.
    //
    // onDidCloseTextDocument fires too late — the document is already
    // detached and workbench.action.files.revert has no editor to target.
    //
    // tabGroups.onDidChangeTabs fires when tabs change, and at that point
    // the document is still in VS Code's model. We can open it via
    // openTextDocument, read the clean on-disk content, and replace the
    // buffer via WorkspaceEdit — making it non-dirty so hot-exit won't
    // preserve the patched state.
    this.tabCloseListener = vscode.window.tabGroups.onDidChangeTabs(async (event) => {
      for (const closedTab of event.closed) {
        if (closedTab.input instanceof vscode.TabInputText) {
          const fileUri = closedTab.input.uri.toString();
          if (this.fileUriToHandler.has(fileUri)) {
            this.logger.info(
              `[Manager] Tab closed for file with active diff, cleaning up: ${fileUri}`,
            );
            await this.clearForClosedTab(fileUri, closedTab.input.uri);
          }
        }
      }
    });
  }

  /**
   * Auto-save document when all decorators are resolved
   * This mimics the behavior of "Apply All Changes" but for manual decorator clearing
   */
  private async autoSaveDocument(fileUri: string, finalContent: string): Promise<void> {
    try {
      this.logger.info(`[Manager] Auto-saving document after all decorators resolved: ${fileUri}`);

      // Get the document
      const uri = vscode.Uri.parse(fileUri);
      const document = await vscode.workspace.openTextDocument(uri);

      // Check if the document has unsaved changes (isDirty indicates unsaved changes)
      if (document.isDirty) {
        this.logger.debug(`[Manager] Document has unsaved changes, saving now`);

        // Save the document directly since content is already updated by decorators
        await document.save();
        this.logger.info(`[Manager] Successfully auto-saved document: ${uri.fsPath}`);
      } else {
        this.logger.debug(`[Manager] Document has no unsaved changes, no save needed`);
      }
    } catch (error) {
      this.logger.error(`[Manager] Failed to auto-save document ${fileUri}:`, error);
    }
  }

  async createVerticalDiffHandler(
    fileUri: string,
    startLine: number,
    endLine: number,
    options: VerticalDiffHandlerOptions,
  ): Promise<VerticalDiffHandler | undefined> {
    if (this.fileUriToHandler.has(fileUri)) {
      await this.fileUriToHandler.get(fileUri)?.clear(false);
      this.fileUriToHandler.delete(fileUri);
    }
    const editor = vscode.window.activeTextEditor;
    if (editor && URI.equal(editor.document.uri.toString(), fileUri)) {
      const handler = new VerticalDiffHandler(
        startLine,
        endLine,
        editor,
        this.fileUriToCodeLens,
        this.clearForFileUri.bind(this),
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
    _handler: VerticalDiffHandler,
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
      this.logger.debug(`Document change at line ${lineNumber}, delta: ${lineDelta}`);
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
      this.logger.warn(`No handler found for file: ${fileUri}`);
      return;
    }

    const blocks = this.fileUriToCodeLens.get(fileUri);
    if (!blocks) {
      this.logger.warn(`No code lens blocks found for file: ${fileUri}`);
      return;
    }

    const block = index !== undefined ? blocks[index] : blocks[0];
    if (!block) {
      this.logger.warn(`Block at index ${index} not found`);
      return;
    }

    await handler.acceptRejectBlock(accept, block.start, block.numGreen, block.numRed);

    if (blocks.length === 1) {
      // All blocks resolved via individual codelens — notify before cleanup.
      // We fire onAllBlocksResolved here (not from onStatusUpdate) to avoid
      // double-fires and to have direct access to the accept/reject flag.
      const streamId = this.fileUriToStreamId.get(fileUri);
      if (streamId && this.onAllBlocksResolved) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(fileUri));
        this.onAllBlocksResolved(streamId, fileUri, doc.getText(), accept);
      }
      await this.clearForFileUri(fileUri, true);
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

  /**
   * Clean up diff state when a tab is closed by the user.
   *
   * Unlike clearForFileUri, this does NOT call handler.clear() because the
   * editor is gone and editor edits would silently fail, leaving the in-memory
   * buffer dirty with patched content.
   *
   * Instead it:
   * 1. Clears all internal state (handler, codelens, streamId, decorators)
   * 2. Disposes the handler without running accept/reject edits
   * 3. Reads the clean on-disk content and replaces the document buffer via
   *    WorkspaceEdit — this makes the document non-dirty so VS Code's hot-exit
   *    won't preserve the patched state
   *
   * See #1362 — without this, closing the tab left the file showing patched
   * content even though git status showed no changes.
   */
  private async clearForClosedTab(fileUri: string, uri: vscode.Uri): Promise<void> {
    // --- 1. Clear activeDecorators ---
    const streamId = this.fileUriToStreamId.get(fileUri);
    if (streamId) {
      this.mutateDecorators((draft) => {
        if (draft.activeDecorators && draft.activeDecorators[streamId]) {
          delete draft.activeDecorators[streamId];
          this.logger.info(
            `[Manager] Cleared activeDecorators for streamId: ${streamId} via clearForClosedTab`,
          );
        }
      });
      this.fileUriToStreamId.delete(fileUri);
    }

    // --- 2. Dispose handler without editor edits ---
    const handler = this.fileUriToHandler.get(fileUri);
    if (handler) {
      handler.dispose();
      this.fileUriToHandler.delete(fileUri);
    }

    // --- 3. Clean up remaining state ---
    this.disableDocumentChangeListener();
    this.fileUriToCodeLens.delete(fileUri);
    this.refreshCodeLens();
    void vscode.commands.executeCommand("setContext", `${EXTENSION_NAME}.diffVisible`, false);

    // --- 4. Restore the document buffer to on-disk content ---
    // The diff handler inserted/deleted lines in the editor buffer but never
    // saved. VS Code's hot-exit may preserve this dirty buffer across reloads.
    // By reading the clean disk content and applying it via WorkspaceEdit, the
    // document content matches disk -> isDirty becomes false -> hot-exit ignores it.
    try {
      const diskBytes = await vscode.workspace.fs.readFile(uri);
      const diskContent = new TextDecoder().decode(diskBytes);

      // Open the document in memory (not in a visible editor)
      const doc = await vscode.workspace.openTextDocument(uri);

      if (doc.isDirty) {
        const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
        const wsEdit = new vscode.WorkspaceEdit();
        wsEdit.replace(uri, fullRange, diskContent);
        await vscode.workspace.applyEdit(wsEdit);
        this.logger.info(
          `[Manager] Restored document buffer to disk content after tab close: ${fileUri}`,
        );
      } else {
        this.logger.debug(
          `[Manager] Document not dirty after tab close, no restore needed: ${fileUri}`,
        );
      }
    } catch (error) {
      // If the document is fully disposed, the next open will read from disk.
      this.logger.debug(
        `[Manager] Could not restore document buffer (may already be fully closed): ${fileUri}`,
        error,
      );
    }

    // --- 5. Notify status change ---
    if (this.onDiffStatusChange) {
      this.onDiffStatusChange(fileUri);
    }
  }

  async clearForFileUri(fileUri: string | undefined, accept: boolean = false) {
    if (!fileUri) {
      return;
    }

    // Clean up streamId mapping (but do NOT clear activeDecorators here —
    // the batch review webview uses activeDecorators to determine if a diff
    // is still in-progress. Clearing it here races with pendingBatchReview
    // removal and causes buttons to flash. activeDecorators is only cleared
    // in clearForClosedTab for the tab-close case.)
    const streamId = this.fileUriToStreamId.get(fileUri);
    if (streamId) {
      this.fileUriToStreamId.delete(fileUri);
    }

    const handler = this.fileUriToHandler.get(fileUri);
    if (handler) {
      await handler.clear(accept);
      this.fileUriToHandler.delete(fileUri);
    }

    this.disableDocumentChangeListener();

    this.fileUriToCodeLens.delete(fileUri);
    this.refreshCodeLens();

    void vscode.commands.executeCommand("setContext", `${EXTENSION_NAME}.diffVisible`, false);

    // Notify status change
    if (this.onDiffStatusChange) {
      this.onDiffStatusChange(fileUri);
    }
  }

  /**
   * Simplified method for streaming diff lines for static diffs
   */
  async streamDiffLines(diffStream: AsyncGenerator<DiffLine>, streamId?: string) {
    this.logger.debug(`[Manager] streamDiffLines called - streamId: ${streamId}`);
    void vscode.commands.executeCommand("setContext", `${EXTENSION_NAME}.diffVisible`, true);

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.logger.warn("[Manager] No active editor");
      return;
    }

    const fileUri = editor.document.uri.toString();
    this.logger.debug(`[Manager] Working with file: ${fileUri}`);

    // Track the streamId for this file
    if (streamId) {
      this.fileUriToStreamId.set(fileUri, streamId);
      this.logger.debug(`[Manager] Mapped fileUri ${fileUri} to streamId ${streamId}`);
    }

    const startLine = 0;
    const endLine = editor.document.lineCount - 1;
    this.logger.debug(`[Manager] Selection range: ${startLine}-${endLine}`);

    // Small delay to ensure UI updates
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Create new handler
    this.logger.debug("[Manager] Creating new vertical diff handler");
    const diffHandler = await this.createVerticalDiffHandler(fileUri, startLine, endLine, {
      onStatusUpdate: (status, numDiffs, fileContent) => {
        this.logger.debug(`[Manager] Status update: ${status}, numDiffs: ${numDiffs}`);

        // Update cache when status is "closed" and we have final file content
        if (status === "closed" && fileContent) {
          try {
            // Convert fileUri to absolute file system path for cache key
            // This ensures the path format matches what the agent expects (absolute paths)
            const filePath = fileUriToPath(fileUri);
            this.kaiFsCache.set(filePath, fileContent);
            this.logger.debug(`[Manager] Updated cache for file: ${filePath}`);
          } catch (error) {
            this.logger.error(`[Manager] Failed to update cache:`, error);
          }
        }

        // Do NOT clear activeDecorators here — it races with
        // pendingBatchReview removal and causes the webview to flash
        // "Accept/Reject/Review" buttons. Decorator cleanup is handled:
        //  - Tab close: clearForClosedTab clears it
        //  - Accept/reject: batch removal makes the entry irrelevant
        if ((status === "closed" || numDiffs === 0) && streamId) {
          // Auto-save the document when all decorators are resolved
          if (status === "closed" && fileContent) {
            this.autoSaveDocument(fileUri, fileContent);
          }

          // NOTE: onAllBlocksResolved is NOT fired here. It is called
          // directly from acceptRejectVerticalDiffBlock with the correct
          // accept/reject flag. Firing it from onStatusUpdate caused
          // double-fires (once from acceptRejectBlock, once from clear())
          // and had no way to know accept vs reject.
        }
      },
      streamId,
      onDiffStatusChange: (fileUri) => {
        if (this.onDiffStatusChange) {
          this.onDiffStatusChange(fileUri);
        }
      },
    });

    if (!diffHandler) {
      this.logger.warn("[Manager] Failed to create vertical diff handler");
      return;
    }

    void vscode.commands.executeCommand("setContext", `${EXTENSION_NAME}.streamingDiff`, true);

    try {
      this.logger.debug("[Manager] Starting diff handler.run()");
      this.logDiffs = await diffHandler.run(diffStream);
      this.logger.debug(`[Manager] Diff handler completed, logDiffs: ${this.logDiffs?.length}`);

      // Enable listener for user edits to file while diff is open
      this.enableDocumentChangeListener();
    } catch (e) {
      this.logger.error("[Manager] Error in streamDiffLines:", e);
      this.disableDocumentChangeListener();
      throw e;
    } finally {
      void vscode.commands.executeCommand("setContext", `${EXTENSION_NAME}.streamingDiff`, false);
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
      // Accept all blocks - take a shallow copy to avoid race conditions
      const blocks = this.fileUriToCodeLens.get(fileUri)?.slice();
      if (blocks) {
        for (const block of blocks) {
          await handler.acceptRejectBlock(true, block.start, block.numGreen, block.numRed);
        }
      }
      await this.clearForFileUri(fileUri, true);
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
      // Reject all blocks - take a shallow copy to avoid race conditions
      const blocks = this.fileUriToCodeLens.get(fileUri)?.slice();
      if (blocks) {
        for (const block of blocks) {
          await handler.acceptRejectBlock(false, block.start, block.numGreen, block.numRed);
        }
      }
      await this.clearForFileUri(fileUri, false);
    }
  }

  /**
   * Dispose of all resources and clear all active diffs
   * Called during extension deactivation to prevent memory leaks
   */
  async dispose() {
    // Clear all active handlers
    for (const [fileUri, handler] of this.fileUriToHandler.entries()) {
      try {
        await handler.clear(false);
      } catch (error) {
        this.logger.error(`Error clearing handler for ${fileUri}:`, error);
      }
    }
    this.fileUriToHandler.clear();

    // Clear all code lens
    this.fileUriToCodeLens.clear();

    // Clear streamId mappings
    this.fileUriToStreamId.clear();

    // Dispose document change listener
    this.disableDocumentChangeListener();

    // Dispose close document listener
    if (this.tabCloseListener) {
      this.tabCloseListener.dispose();
      this.tabCloseListener = undefined;
    }

    // Clear callback references
    this.onDiffStatusChange = undefined;
    this.refreshCodeLens = () => {};
  }
}
