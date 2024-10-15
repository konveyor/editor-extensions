import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import { registerAllCommands } from "./commands";
import { ExtensionState, SharedState } from "./extensionState";
import { ViolationCodeActionProvider } from "./ViolationCodeActionProvider";
import { AnalyzerClient } from "./client/analyzerClient";

export class VsCodeExtension {
  private extensionContext: vscode.ExtensionContext;
  private windowId: string;
  private state: ExtensionState;

  constructor(context: vscode.ExtensionContext) {
    this.extensionContext = context;
    this.windowId = uuidv4();

    this.state = {
      analyzerClient: new AnalyzerClient(context),
      sharedState: new SharedState(),
      webviewProviders: new Set<KonveyorGUIWebviewViewProvider>(),
      sidebarProvider: undefined as any,
      extensionContext: context,
    };

    const sidebarProvider = new KonveyorGUIWebviewViewProvider(this.windowId, this.state);

    this.state.sidebarProvider = sidebarProvider;
    this.state.webviewProviders.add(sidebarProvider);

    // Check for multi-root workspace
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
      vscode.window.showWarningMessage(
        "Konveyor does not currently support multi-root workspaces. Only the first workspace folder will be analyzed.",
      );
    }

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("konveyor.konveyorGUIView", sidebarProvider, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }),
    );

    registerAllCommands(this.state);

    const languagesToRegister = ["java"];

    for (const language of languagesToRegister) {
      context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(language, new ViolationCodeActionProvider(), {
          providedCodeActionKinds: ViolationCodeActionProvider.providedCodeActionKinds,
        }),
      );
    }
  }

  getAnalyzerClient(): AnalyzerClient {
    return this.state.analyzerClient;
  }
}
