import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import { registerAllCommands } from "./commands";
import { setupWebviewMessageListener } from "./webviewMessageHandler";
import { ExtensionState } from "./extensionState";

export class VsCodeExtension {
  private extensionContext: vscode.ExtensionContext;
  private windowId: string;
  private state: ExtensionState;

  constructor(context: vscode.ExtensionContext) {
    this.extensionContext = context;
    this.windowId = uuidv4();

    const sidebarProvider = new KonveyorGUIWebviewViewProvider(
      this.windowId,
      this.extensionContext,
    );

    // Check for multi-root workspace
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
      vscode.window.showWarningMessage(
        "Konveyor does not currently support multi-root workspaces. Only the first workspace folder will be analyzed."
      );
    }

    this.state = {
      sidebarProvider,
    };

    // Sidebar
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        "konveyor.konveyorGUIView",
        sidebarProvider,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        },
      ),
    );

    sidebarProvider.onWebviewReady((webview) => {
      setupWebviewMessageListener(webview);
    });

    // Commands
    registerAllCommands(this.extensionContext, this.state);
  }
}
