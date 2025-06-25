import * as vscode from "vscode";
import { LocalChange } from "@editor-extensions/shared";
import { parsePatch, ParsedDiff, Hunk } from "diff";
import { activeDecorations } from "./inlineSuggestionCodeActionProvider";

/**
 * Manages decorations for inline suggestions in the editor
 */
export class InlineSuggestionDecorator {
  // Decoration type for added lines (green background)
  private static additionDecorationType: vscode.TextEditorDecorationType =
    vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(0, 255, 0, 0.1)",
      border: "1px solid rgba(0, 255, 0, 0.3)",
      borderRadius: "3px",
      isWholeLine: true, // Highlight the entire line
      before: {
        contentText: "➕ ",
        color: "#3c3",
      },
    });

  // Decoration type for deleted lines (red background with strikethrough)
  private static deletionDecorationType: vscode.TextEditorDecorationType =
    vscode.window.createTextEditorDecorationType({
      backgroundColor: "rgba(255, 0, 0, 0.1)",
      border: "1px solid rgba(255, 0, 0, 0.3)",
      borderRadius: "3px",
      textDecoration: "line-through rgba(255, 0, 0, 0.5)",
      opacity: "0.7", // Make deleted text slightly faded
      isWholeLine: false,
      before: {
        contentText: "➖ ",
        color: "#c33",
      },
    });

  // Decoration type for inline suggestions (green checkmark)
  private static inlineSuggestionDecorationType: vscode.TextEditorDecorationType =
    vscode.window.createTextEditorDecorationType({
      after: {
        contentText: "✓",
        backgroundColor: "rgba(0, 255, 0, 0.1)",
        border: "1px solid rgba(0, 255, 0, 0.3)",
        // borderRadius is not supported in ThemableDecorationAttachmentRenderOptions
        margin: "0 0 0 10px",
        color: "#3c3",
      },
    });

  // Static status bar items to prevent duplicates
  private static statusBarItem: vscode.StatusBarItem | undefined;
  private static acceptButton: vscode.StatusBarItem | undefined;
  private static rejectButton: vscode.StatusBarItem | undefined;

  // Flag to indicate that changes are being made by our extension
  // This can be used to prevent analysis from being triggered
  public static isApplyingChanges = false;

  /**
   * Apply decorations to the editor based on the diff
   * This method applies the changes directly to the buffer and decorates deletions
   * @param editor The text editor to apply decorations to
   * @param change The LocalChange object containing the diff
   */
  public static async applyDecorations(
    editor: vscode.TextEditor,
    change: LocalChange,
  ): Promise<void> {
    // Clear any existing decorations
    this.clearDecorations(editor);

    if (!change.diff) {
      console.log("No diff available for decoration");
      return;
    }

    // Store the change in the active decorations map
    activeDecorations.set(editor.document.uri.toString(), change);

    try {
      // Parse the diff to get the changes
      const parsedDiff = parsePatch(change.diff);
      if (!parsedDiff || parsedDiff.length === 0) {
        console.log("Failed to parse diff");
        return;
      }

      // Process each file in the diff (usually just one)
      // This will apply the changes to the buffer and decorate deletions
      for (const fileDiff of parsedDiff) {
        await this.processFileDiff(editor, fileDiff);
      }

      // Count additions and deletions for summary
      let additionCount = 0;
      let deletionCount = 0;

      for (const hunk of parsedDiff[0].hunks) {
        for (const line of hunk.lines) {
          if (line.startsWith("+")) {
            additionCount++;
          } else if (line.startsWith("-")) {
            deletionCount++;
          }
        }
      }

      // Use static status bar items to prevent duplicates
      if (!this.statusBarItem) {
        this.statusBarItem = vscode.window.createStatusBarItem(
          vscode.StatusBarAlignment.Right,
          100,
        );
      }
      this.statusBarItem.text = `$(diff) Changes: ${additionCount} additions, ${deletionCount} deletions`;
      this.statusBarItem.tooltip = "Summary of applied changes";
      this.statusBarItem.show();

      // Create accept/reject buttons if they don't exist
      if (!this.acceptButton) {
        this.acceptButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        this.acceptButton.text = "$(check) Accept";
        this.acceptButton.tooltip = "Accept the suggested changes";
        this.acceptButton.command = "inlineSuggestion.acceptChanges";
      }
      this.acceptButton.show();

      if (!this.rejectButton) {
        this.rejectButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
        this.rejectButton.text = "$(x) Reject";
        this.rejectButton.tooltip = "Reject the suggested changes and revert buffer";
        this.rejectButton.command = "inlineSuggestion.rejectChanges";
      }
      this.rejectButton.show();

      // Hide the status bar items after 30 seconds
      setTimeout(() => {
        if (this.statusBarItem) {
          this.statusBarItem.hide();
        }
        if (this.acceptButton) {
          this.acceptButton.hide();
        }
        if (this.rejectButton) {
          this.rejectButton.hide();
        }
      }, 30000);

      // Also show a message in the status bar
      vscode.window.setStatusBarMessage(
        `Preview applied: ${additionCount} additions, ${deletionCount} deletions. Press Undo (Ctrl+Z/Cmd+Z) to revert.`,
        5000,
      );
    } catch (error) {
      console.error("Error applying decorations:", error);
    }
  }

  /**
   * Process a single file diff and apply decorations
   * This method follows the "apply buffer then decorate deletions" approach:
   * 1. Apply additions directly to the buffer (like git apply)
   * 2. Decorate deletions with strike-through styling
   * 3. Optionally highlight newly added lines
   *
   * This approach eliminates the need for blank line hacks and provides
   * a more natural editing experience with proper scrolling and text selection.
   *
   * @param editor The text editor
   * @param fileDiff The parsed diff for a file
   */
  private static async processFileDiff(
    editor: vscode.TextEditor,
    fileDiff: ParsedDiff,
  ): Promise<void> {
    // Set flag to indicate we're making changes
    // This can be used to prevent analysis from being triggered
    this.isApplyingChanges = true;

    try {
      // First: apply additions directly into buffer
      await editor.edit((editBuilder) => {
        for (const hunk of fileDiff.hunks) {
          let newLine = hunk.newStart - 1; // newStart is 1-based
          for (const line of hunk.lines) {
            if (line.startsWith("+")) {
              // Add the new line content (without the '+' prefix)
              editBuilder.insert(new vscode.Position(newLine, 0), line.slice(1) + "\n");
              newLine++;
            } else if (line.startsWith(" ")) {
              // Context line - just increment the line counter
              newLine++;
            }
            // Deletions are handled separately with decorations
          }
        }
      });
    } finally {
      // Reset flag when done
      this.isApplyingChanges = false;
    }

    // Now process the hunks for decorations (primarily for deletions)
    const additionDecorations: vscode.DecorationOptions[] = [];
    const deletionDecorations: vscode.DecorationOptions[] = [];
    const inlineSuggestionDecorations: vscode.DecorationOptions[] = [];

    // Process each hunk in the diff for decorations
    for (const hunk of fileDiff.hunks) {
      await this.processHunkForDeletions(editor, hunk, deletionDecorations);

      // Optionally highlight newly added lines
      await this.processHunkForAdditions(
        editor,
        hunk,
        additionDecorations,
        inlineSuggestionDecorations,
      );
    }

    // Apply the decorations to the editor
    editor.setDecorations(this.additionDecorationType, additionDecorations);
    editor.setDecorations(this.deletionDecorationType, deletionDecorations);
    editor.setDecorations(this.inlineSuggestionDecorationType, inlineSuggestionDecorations);
  }

  /**
   * Process a single hunk for deletions and create decorations
   * @param editor The text editor
   * @param hunk The hunk to process
   * @param deletionDecorations Array to collect deletion decorations
   */
  private static async processHunkForDeletions(
    editor: vscode.TextEditor,
    hunk: Hunk,
    deletionDecorations: vscode.DecorationOptions[],
  ): Promise<void> {
    // The line in the new file where the hunk starts (0-based)
    let newLine = hunk.newStart > 0 ? hunk.newStart - 1 : 0;
    let oldLine = hunk.oldStart > 0 ? hunk.oldStart - 1 : 0;

    // Process each line in the hunk
    const lines = hunk.lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("-")) {
        // Deleted line - find the corresponding position in the current file
        const lineText = line.substring(1);

        // Try to find an exact match for the deleted text
        // This is more robust than just using line numbers
        try {
          // First try to find the exact line at the expected position
          if (oldLine < editor.document.lineCount) {
            const docLine = editor.document.lineAt(oldLine);

            if (docLine.text === lineText) {
              // Exact match at expected position
              const range = new vscode.Range(
                new vscode.Position(oldLine, 0),
                new vscode.Position(oldLine, lineText.length),
              );

              deletionDecorations.push({
                range,
                hoverMessage: "Suggested deletion",
              });

              oldLine++; // Increment old line counter
              continue;
            }
          }

          // If we didn't find an exact match, look for the text within the line
          // or in nearby lines (in case line numbers are off)
          const searchStart = Math.max(0, oldLine - 3);
          const searchEnd = Math.min(editor.document.lineCount, oldLine + 3);

          let found = false;
          for (let j = searchStart; j < searchEnd; j++) {
            const docLine = editor.document.lineAt(j);

            if (docLine.text.includes(lineText)) {
              const startPos = docLine.text.indexOf(lineText);
              const range = new vscode.Range(
                new vscode.Position(j, startPos),
                new vscode.Position(j, startPos + lineText.length),
              );

              deletionDecorations.push({
                range,
                hoverMessage: "Suggested deletion",
              });

              found = true;
              break;
            }
          }

          if (!found) {
            // If we still can't find it, use the original line number as fallback
            const range = new vscode.Range(
              new vscode.Position(oldLine, 0),
              new vscode.Position(
                oldLine,
                Math.min(
                  lineText.length,
                  oldLine < editor.document.lineCount
                    ? editor.document.lineAt(oldLine).text.length
                    : 0,
                ),
              ),
            );

            deletionDecorations.push({
              range,
              hoverMessage: "Suggested deletion (approximate position)",
            });
          }
        } catch (error) {
          console.error("Error processing deletion:", error);
        }

        oldLine++; // Always increment old line counter for deletions
      } else if (line.startsWith(" ")) {
        // Context line - increment both line counters
        newLine++;
        oldLine++;
      } else if (line.startsWith("+")) {
        // Addition - only increment new line counter
        newLine++;
      }
    }
  }

  /**
   * Process a single hunk for additions and create decorations
   * @param editor The text editor
   * @param hunk The hunk to process
   * @param additionDecorations Array to collect addition decorations
   * @param inlineSuggestionDecorations Array to collect inline suggestion decorations
   */
  private static async processHunkForAdditions(
    editor: vscode.TextEditor,
    hunk: Hunk,
    additionDecorations: vscode.DecorationOptions[],
    inlineSuggestionDecorations: vscode.DecorationOptions[],
  ): Promise<void> {
    // The line in the new file where the hunk starts (0-based)
    let newLine = hunk.newStart > 0 ? hunk.newStart - 1 : 0;

    // Process each line in the hunk
    const lines = hunk.lines;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("+")) {
        const lineText = line.substring(1);

        // Since we've already applied the additions to the buffer,
        // we can directly highlight the actual lines
        const range = new vscode.Range(
          new vscode.Position(newLine, 0),
          new vscode.Position(newLine, editor.document.lineAt(newLine).text.length),
        );

        // Add decoration for the entire line
        additionDecorations.push({
          range,
          hoverMessage: "Added line",
          renderOptions: {
            light: {
              after: {
                contentText: " // Added",
                color: "#3c3",
                fontStyle: "italic",
              },
            },
            dark: {
              after: {
                contentText: " // Added",
                color: "#3c3",
                fontStyle: "italic",
              },
            },
          },
        });

        // Add checkmark at the beginning of the line
        inlineSuggestionDecorations.push({
          range: new vscode.Range(new vscode.Position(newLine, 0), new vscode.Position(newLine, 0)),
          hoverMessage: "Added line",
        });

        newLine++;
      } else if (line.startsWith(" ")) {
        // Context line - just increment the line counter
        newLine++;
      }
      // Deletions are handled in processHunkForDeletions
    }
  }

  /**
   * Clear all decorations from the editor
   * Note: This only clears decorations, it does not revert buffer changes.
   * Users should use the editor's undo functionality to revert changes.
   * @param editor The text editor
   */
  public static clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.additionDecorationType, []);
    editor.setDecorations(this.deletionDecorationType, []);
    editor.setDecorations(this.inlineSuggestionDecorationType, []);

    // Remove from active decorations map
    activeDecorations.delete(editor.document.uri.toString());
  }

  /**
   * Dispose of all decoration types and status bar items
   */
  public static dispose(): void {
    this.additionDecorationType.dispose();
    this.deletionDecorationType.dispose();
    this.inlineSuggestionDecorationType.dispose();

    // Dispose of status bar items
    if (this.statusBarItem) {
      this.statusBarItem.dispose();
      this.statusBarItem = undefined;
    }
    if (this.acceptButton) {
      this.acceptButton.dispose();
      this.acceptButton = undefined;
    }
    if (this.rejectButton) {
      this.rejectButton.dispose();
      this.rejectButton = undefined;
    }
  }

  /**
   * Accept the changes, clear decorations, and save the file
   * This method is called when the user accepts the changes
   * @param editor The text editor
   */
  public static async acceptChanges(editor: vscode.TextEditor): Promise<void> {
    // Set flag to indicate we're making changes
    this.isApplyingChanges = true;

    try {
      // Clear decorations but keep the buffer changes
      this.clearDecorations(editor);

      // Save the file
      await editor.document.save();

      // Show a message to the user
      vscode.window.setStatusBarMessage(
        "Changes accepted, applied to the buffer, and file saved.",
        3000,
      );
    } finally {
      // Reset flag when done
      this.isApplyingChanges = false;
    }
  }

  /**
   * Reject the changes, revert the buffer, and save the file
   * This method is called when the user rejects the changes
   * @param editor The text editor
   */
  public static async rejectChanges(editor: vscode.TextEditor): Promise<void> {
    // Set flag to indicate we're making changes
    this.isApplyingChanges = true;

    try {
      // First undo the buffer changes
      await vscode.commands.executeCommand("editor.action.undo");

      // Then clear decorations
      this.clearDecorations(editor);

      // Save the file
      await editor.document.save();

      // Show a message to the user
      vscode.window.setStatusBarMessage("Changes rejected, reverted, and file saved.", 3000);
    } finally {
      // Reset flag when done
      this.isApplyingChanges = false;
    }
  }

  /**
   * Register commands for accepting and rejecting changes
   * @param context The extension context
   */
  public static registerCommands(context: vscode.ExtensionContext): void {
    // Register command to accept changes
    context.subscriptions.push(
      vscode.commands.registerCommand("inlineSuggestion.acceptChanges", async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          await this.acceptChanges(editor);
        }
      }),
    );

    // Register command to reject changes
    context.subscriptions.push(
      vscode.commands.registerCommand("inlineSuggestion.rejectChanges", async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          await this.rejectChanges(editor);
        }
      }),
    );

    // Use static status bar items to prevent duplicates
    if (!this.acceptButton) {
      this.acceptButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
      this.acceptButton.text = "$(check) Accept Changes";
      this.acceptButton.tooltip = "Accept the suggested changes";
      this.acceptButton.command = "inlineSuggestion.acceptChanges";
    }

    if (!this.rejectButton) {
      this.rejectButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 98);
      this.rejectButton.text = "$(x) Reject Changes";
      this.rejectButton.tooltip = "Reject the suggested changes";
      this.rejectButton.command = "inlineSuggestion.rejectChanges";
    }

    // Show status bar items when there are active decorations
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && activeDecorations.has(editor.document.uri.toString())) {
          if (this.acceptButton) {
            this.acceptButton.show();
          }
          if (this.rejectButton) {
            this.rejectButton.show();
          }
        } else {
          if (this.acceptButton) {
            this.acceptButton.hide();
          }
          if (this.rejectButton) {
            this.rejectButton.hide();
          }
        }
      }),
    );
  }
}
