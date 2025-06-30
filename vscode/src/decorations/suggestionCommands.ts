import * as vscode from "vscode";
import { LocalChange } from "@editor-extensions/shared";
import { InlineSuggestionDecorator } from "./inlineSuggestionDecorator";

/**
 * Notify the webview that a change has been accepted or rejected
 * @param change The LocalChange object with diff information
 * @param action The action taken (applied or rejected)
 */
function notifyWebview(change: LocalChange, action: "applied" | "rejected"): void {
  // Send a message to all webviews via the command
  vscode.commands.executeCommand("konveyor.notifyWebviewOfFileAction", {
    path: change.originalUri || change.modifiedUri,
    messageToken: change.messageToken,
    action,
  });
}

/**
 * Register commands for accepting/rejecting suggested changes
 * @param context Extension context
 */
export function registerSuggestionCommands(context: vscode.ExtensionContext): void {
  // Register the new commands for accepting/rejecting changes
  InlineSuggestionDecorator.registerCommands(context);

  // Register command for accepting all suggested changes
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "konveyor.acceptSuggestedChanges",
      async (uri: vscode.Uri, change: LocalChange) => {
        try {
          // Use our new acceptChanges method
          const editor = await vscode.window.showTextDocument(uri);
          InlineSuggestionDecorator.acceptChanges(editor);
          vscode.window.showInformationMessage("All suggested changes accepted");

          // Notify webview that changes were accepted
          notifyWebview(change, "applied");
        } catch (error) {
          vscode.window.showErrorMessage(`Error accepting changes: ${error}`);
        }
      },
    ),
  );

  // Register command for rejecting all suggested changes
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "konveyor.rejectSuggestedChanges",
      async (uri: vscode.Uri, change: LocalChange) => {
        try {
          // Use our new rejectChanges method
          const editor = await vscode.window.showTextDocument(uri);
          InlineSuggestionDecorator.rejectChanges(editor);
          vscode.window.showInformationMessage("All suggested changes rejected");

          // Notify webview that changes were rejected
          notifyWebview(change, "rejected");
        } catch (error) {
          vscode.window.showErrorMessage(`Error rejecting changes: ${error}`);
        }
      },
    ),
  );

  // Register command for accepting a specific change
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "konveyor.acceptSpecificChange",
      async (
        uri: vscode.Uri,
        change: LocalChange,
        lineNumber: number,
        changeType: "addition" | "deletion",
      ) => {
        try {
          // For now, we'll just accept all changes
          // In the future, we could enhance this to accept specific changes
          const editor = await vscode.window.showTextDocument(uri);
          InlineSuggestionDecorator.acceptChanges(editor);
          vscode.window.showInformationMessage(
            `${changeType === "addition" ? "Addition" : "Deletion"} accepted`,
          );

          // Notify webview that changes were accepted
          notifyWebview(change, "applied");
        } catch (error) {
          vscode.window.showErrorMessage(`Error accepting specific change: ${error}`);
        }
      },
    ),
  );

  // Register command for rejecting a specific change
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "konveyor.rejectSpecificChange",
      async (
        uri: vscode.Uri,
        change: LocalChange,
        lineNumber: number,
        changeType: "addition" | "deletion",
      ) => {
        try {
          // For now, we'll just reject all changes
          // In the future, we could enhance this to reject specific changes
          const editor = await vscode.window.showTextDocument(uri);
          InlineSuggestionDecorator.rejectChanges(editor);
          vscode.window.showInformationMessage(
            `${changeType === "addition" ? "Addition" : "Deletion"} rejected`,
          );

          // Notify webview that changes were rejected
          notifyWebview(change, "rejected");
        } catch (error) {
          vscode.window.showErrorMessage(`Error rejecting specific change: ${error}`);
        }
      },
    ),
  );
}

/**
 * Accept all suggested changes for a file
 * @param uri The file URI
 * @param change The LocalChange object with diff information
 */
async function acceptAllChanges(uri: vscode.Uri, change: LocalChange): Promise<void> {
  if (!change.diff) {
    throw new Error("No diff available to apply");
  }

  try {
    // Open the document and get the editor
    const editor = await vscode.window.showTextDocument(uri);

    // Use our new acceptChanges method
    // The changes have already been applied to the buffer by the decorator,
    // so we just need to clear the decorations
    InlineSuggestionDecorator.acceptChanges(editor);
  } catch (error) {
    console.error("Error accepting changes:", error);
    throw error;
  }
}

/**
 * Accept a specific suggested change
 * @param uri The file URI
 * @param change The LocalChange object with diff information
 * @param lineNumber The line number of the change
 * @param changeType The type of change (addition or deletion)
 */
async function acceptSpecificChange(
  uri: vscode.Uri,
  change: LocalChange,
  lineNumber: number,
  changeType: "addition" | "deletion",
): Promise<void> {
  if (!change.diff) {
    throw new Error("No diff available to apply");
  }

  try {
    // Open the document and get the editor
    const editor = await vscode.window.showTextDocument(uri);

    // For now, we'll just accept all changes
    // In the future, we could enhance this to accept specific changes
    InlineSuggestionDecorator.acceptChanges(editor);
  } catch (error) {
    console.error("Error accepting specific change:", error);
    throw error;
  }
}
