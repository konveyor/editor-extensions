import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import { registerAllCommands } from "./commands";
import { setupWebviewMessageListener } from "./webviewMessageHandler";

export class VsCodeExtension {
  private extensionContext: vscode.ExtensionContext;
  private sidebar: KonveyorGUIWebviewViewProvider;
  private windowId: string;

  constructor(context: vscode.ExtensionContext) {
    this.extensionContext = context;
    this.windowId = uuidv4();
    this.sidebar = new KonveyorGUIWebviewViewProvider(
      this.windowId,
      this.extensionContext
    );

    // Check for multi-root workspace
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
      vscode.window.showWarningMessage(
        "Konveyor does not currently support multi-root workspaces. Only the first workspace folder will be analyzed."
      );
    }

    // Sidebar
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        "konveyor.konveyorGUIView",
        this.sidebar,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        }
      )
    );

    // Set up message listener when the webview is ready
    this.sidebar.onWebviewReady((webview) => {
      setupWebviewMessageListener(webview);
    });

    // Commands
    registerAllCommands(context, this.extensionContext, this.sidebar);
  }
}
