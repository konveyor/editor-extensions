import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";

export function setupWebviewMessageListener(
  webview: vscode.Webview,
  state: ExtensionState,
  provider: KonveyorGUIWebviewViewProvider,
) {
  webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      case "requestAnalysisData":
        const analysisResults = state.extensionContext.workspaceState.get("analysisResults");
        if (analysisResults && Array.isArray(analysisResults) && analysisResults.length > 0) {
          webview.postMessage({ type: "analysisData", data: analysisResults[0] });
        } else {
          webview.postMessage({ type: "analysisData", data: null });
        }
        break;

      case "startAnalysis":
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
