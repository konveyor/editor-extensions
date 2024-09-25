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
      this.extensionContext,
    );

    // Sidebar
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        "konveyor.konveyorGUIView",
        this.sidebar,
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
        },
      ),
    );

    // Set up message listener when the webview is ready
    this.sidebar.onWebviewReady((webview) => {
      setupWebviewMessageListener(webview);
    });

    // Commands
    registerAllCommands(context, this.sidebar);
  }
}
