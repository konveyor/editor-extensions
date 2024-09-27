import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";

export function setupWebviewMessageListener(
  webview: vscode.Webview,
  state: ExtensionState,
  provider: KonveyorGUIWebviewViewProvider,
) {
  const incidentDataString = state.extensionContext.workspaceState.get<string>(
    "incidentData",
    "[]",
  );
  const incidentData = JSON.parse(incidentDataString);

  webview.onDidReceiveMessage(async (message) => {
    const fileUri = vscode.Uri.parse(message.file);

    switch (message.command) {
      case "requestIncidentData":
        webview.postMessage({
          command: "incidentData",
          data: incidentData,
        });
        break;

      case "openFile":
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
  });
}
