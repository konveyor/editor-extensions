import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";

export function setupWebviewMessageListener(webview: vscode.Webview, state: ExtensionState) {
  webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case "requestQuickfix": {
        const { uri, line } = message.data;
        await handleRequestQuickFix(uri, line);
        // Implement the quick fix logic here
        // For example, replace the problematic code with a suggested fix
        // const suggestedCode = message.diagnostic.message; // You might need to parse this appropriately
        // const action = new vscode.CodeAction("Apply Quick Fix", vscode.CodeActionKind.QuickFix);
        // action.edit = new vscode.WorkspaceEdit();
        // action.edit.replace(message.documentUri, message.range, suggestedCode);
        // action.diagnostics = [message.diagnostic];
        // action.isPreferred = true;
        // vscode.commands.executeCommand("vscode.executeCodeActionProvider", message.documentUri, message.range, action);
        break;
      }
      case "requestAnalysisData": {
        const analysisResults = state.extensionContext.workspaceState.get("analysisResults");
        if (analysisResults && Array.isArray(analysisResults) && analysisResults.length > 0) {
          webview.postMessage({ type: "analysisData", data: analysisResults[0] });
        } else {
          webview.postMessage({ type: "analysisData", data: null });
        }
        break;
      }

      case "startAnalysis": {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const defaultUri =
          workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri : undefined;

        const options: vscode.OpenDialogOptions = {
          canSelectMany: false,
          canSelectFiles: false,
          canSelectFolders: true,
          openLabel: "Select Folder for Analysis",
          defaultUri: defaultUri,
        };

        const folderUri = await vscode.window.showOpenDialog(options);
        if (folderUri && folderUri[0]) {
          vscode.commands.executeCommand("konveyor.startAnalysis", folderUri[0]);
        } else {
          webview.postMessage({
            type: "analysisFailed",
            message: "No folder selected for analysis.",
          });
        }
        break;
      }

      case "openFile": {
        const fileUri = vscode.Uri.parse(message.file);
        try {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          const editor = await vscode.window.showTextDocument(doc, {
            preview: true,
          });
          const position = new vscode.Position(message.line - 1, 0);
          const range = new vscode.Range(position, position);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to open file: ${error}`);
        }
        break;
      }

      // Add more cases as needed
    }
  });
}

async function handleRequestQuickFix(uriString: string, lineNumber: number) {
  const uri = vscode.Uri.parse(uriString);
  try {
    // Open the document
    const document = await vscode.workspace.openTextDocument(uri);

    // Show the document in the editor
    const editor = await vscode.window.showTextDocument(document, { preview: false });

    // Move the cursor to the specified line and character
    const position = new vscode.Position(lineNumber - 1, 0); // Adjust line number (0-based index)
    const range = new vscode.Range(position, position);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

    // Trigger the quick fix action at the cursor position
    await vscode.commands.executeCommand("editor.action.quickFix");
  } catch (error: any) {
    vscode.window.showErrorMessage(`Could not open file: ${error?.message as string}`);
  }
}
