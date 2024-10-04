import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";

export function setupWebviewMessageListener(
  webview: vscode.Webview,
  state: ExtensionState,
  provider: KonveyorGUIWebviewViewProvider,
) {
  // ... (keep existing code)

  webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      // ... (keep other cases)
      case "showFilePicker":
        const options: vscode.OpenDialogOptions = {
          canSelectMany: false,
          canSelectFiles: false,
          canSelectFolders: true,
          openLabel: "Select Folder for Analysis",
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
      // ... (keep other cases)
    }
  });
}
