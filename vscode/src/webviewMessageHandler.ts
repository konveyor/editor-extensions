import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";

export function setupWebviewMessageListener(
  webview: vscode.Webview,
  extensionState: ExtensionState,
  currentProvider: KonveyorGUIWebviewViewProvider,
) {
  webview.onDidReceiveMessage(async (message: any) => {
    switch (message.command) {
      case "updateState":
        // Update shared state
        extensionState.sharedState.set('sharedData', message.data);

        // Broadcast to other webviews
        for (const provider of extensionState.webviewProviders) {
          if (provider !== currentProvider && provider.webview) {
            provider.webview.postMessage({
              command: "updateState",
              data: message.data,
            });
          }
        }
        break;

      // Handle other commands...
    }
  });
}
