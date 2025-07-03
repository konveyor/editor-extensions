import * as vscode from "vscode";
import { LocalChange } from "@editor-extensions/shared";

/**
 * Stores active decorations for files
 * Key: Document URI string
 * Value: LocalChange object with diff information
 */
export const activeDecorations = new Map<string, LocalChange>();

/**
 * Code action provider for inline suggestions
 * Shows "Accept" and "Reject" actions for decorated lines
 */
export class InlineSuggestionCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  /**
   * Provide code actions for the given document and range
   */
  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<(vscode.Command | vscode.CodeAction)[]> {
    // Check if we have decorations for this document
    const change = activeDecorations.get(document.uri.toString());
    if (!change) {
      return [];
    }

    // Create code actions
    const actions: vscode.CodeAction[] = [];

    // Add "Accept all changes" action
    const acceptAllAction = new vscode.CodeAction(
      "Accept all suggested changes",
      vscode.CodeActionKind.QuickFix,
    );
    acceptAllAction.command = {
      title: "Accept all suggested changes",
      command: "konveyor.acceptSuggestedChanges",
      arguments: [document.uri, change],
    };
    actions.push(acceptAllAction);

    // Add "Reject all changes" action
    const rejectAllAction = new vscode.CodeAction(
      "Reject all suggested changes",
      vscode.CodeActionKind.QuickFix,
    );
    rejectAllAction.command = {
      title: "Reject all suggested changes",
      command: "konveyor.rejectSuggestedChanges",
      arguments: [document.uri, change],
    };
    actions.push(rejectAllAction);

    // If we have a specific line selected, try to find if it has a change
    // and add actions for that specific change
    if (range.isSingleLine) {
      // Parse the diff to find changes for this line
      try {
        const lineNumber = range.start.line;
        const lineText = document.lineAt(lineNumber).text;

        // Check if this line has a change by looking at the diff
        if (change.diff) {
          const lines = change.diff.split("\n");
          let inHunk = false;
          let currentLine = 0;
          let isAddition = false;
          let isDeletion = false;

          for (const line of lines) {
            // Start of a hunk
            if (line.startsWith("@@")) {
              inHunk = true;
              // Parse the hunk header to get the starting line number
              // Format: @@ -oldStart,oldLines +newStart,newLines @@
              const match = line.match(/@@ -\d+,\d+ \+(\d+),\d+ @@/);
              if (match) {
                currentLine = parseInt(match[1], 10) - 1; // 0-based
              }
              continue;
            }

            if (inHunk) {
              if (line.startsWith("+")) {
                // Added line
                if (currentLine === lineNumber) {
                  isAddition = true;
                  break;
                }
                currentLine++;
              } else if (line.startsWith("-")) {
                // Deleted line - more complex to match
                // We need to find if this deletion corresponds to the current line
                isDeletion = true;
                // We don't increment currentLine for deletions
              } else if (line.startsWith(" ")) {
                // Context line
                currentLine++;
              }
            }
          }

          // If this line has a change, add specific actions for it
          if (isAddition || isDeletion) {
            // Add "Accept this change" action
            const acceptAction = new vscode.CodeAction(
              isAddition ? "Accept this addition" : "Accept this deletion",
              vscode.CodeActionKind.QuickFix,
            );
            acceptAction.command = {
              title: isAddition ? "Accept this addition" : "Accept this deletion",
              command: "konveyor.acceptSpecificChange",
              arguments: [document.uri, change, lineNumber, isAddition ? "addition" : "deletion"],
            };
            actions.push(acceptAction);

            // Add "Reject this change" action
            const rejectAction = new vscode.CodeAction(
              isAddition ? "Reject this addition" : "Reject this deletion",
              vscode.CodeActionKind.QuickFix,
            );
            rejectAction.command = {
              title: isAddition ? "Reject this addition" : "Reject this deletion",
              command: "konveyor.rejectSpecificChange",
              arguments: [document.uri, change, lineNumber, isAddition ? "addition" : "deletion"],
            };
            actions.push(rejectAction);
          }
        }
      } catch (error) {
        console.error("Error creating specific change actions:", error);
      }
    }

    return actions;
  }
}
