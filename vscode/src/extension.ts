import * as vscode from "vscode";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import { registerAllCommands as registerAllCommands } from "./commands";
import { ExtensionState } from "./extensionState";
import { ExtensionData } from "@editor-extensions/shared";
import { ViolationCodeActionProvider } from "./ViolationCodeActionProvider";
import { AnalyzerClient } from "./client/analyzerClient";
import { registerDiffView, KonveyorFileModel } from "./diffView";
import { MemFS } from "./data";
import { Immutable, produce } from "immer";
import { IssuesModel, registerIssueView } from "./issueView";

class VsCodeExtension {
  private state: ExtensionState;
  private data: Immutable<ExtensionData>;
  private _onDidChange = new vscode.EventEmitter<Immutable<ExtensionData>>();
  readonly onDidChangeData = this._onDidChange.event;

  constructor(context: vscode.ExtensionContext) {
    this.data = produce(
      {
        localChanges: [],
        ruleSets: [],
        resolutionPanelData: undefined,
        isAnalyzing: false,
        isFetchingSolution: false,
        isStartingServer: false,
        solutionData: undefined,
        serverState: "initial",
        solutionScope: undefined,
      },
      () => {},
    );
    const getData = () => this.data;
    const setData = (data: Immutable<ExtensionData>) => {
      this.data = data;
      this._onDidChange.fire(this.data);
    };
    const mutateData = (recipe: (draft: ExtensionData) => void) => {
      setData(produce(getData(), recipe));
    };

    this.state = {
      analyzerClient: new AnalyzerClient(context, mutateData),
      webviewProviders: new Map<string, KonveyorGUIWebviewViewProvider>(),
      extensionContext: context,
      diagnosticCollection: vscode.languages.createDiagnosticCollection("konveyor"),
      memFs: new MemFS(),
      fileModel: new KonveyorFileModel(),
      issueModel: new IssuesModel(),
      get data() {
        return getData();
      },
      mutateData,
    };

    this.initializeExtension(context);
  }

  private initializeExtension(context: vscode.ExtensionContext): void {
    try {
      this.checkWorkspace();
      this.registerWebviewProvider(context);
      this.onDidChangeData(registerDiffView(this.state));
      this.onDidChangeData(registerIssueView(this.state));
      this.registerCommands();
      this.registerLanguageProviders(context);
      vscode.commands.executeCommand("konveyor.loadResultsFromDataFolder");
    } catch (error) {
      console.error("Error initializing extension:", error);
      vscode.window.showErrorMessage(`Failed to initialize Konveyor extension: ${error}`);
    }
  }

  private checkWorkspace(): void {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
      vscode.window.showWarningMessage(
        "Konveyor does not currently support multi-root workspaces. Only the first workspace folder will be analyzed.",
      );
    }
  }

  private registerWebviewProvider(context: vscode.ExtensionContext): void {
    const sidebarProvider = new KonveyorGUIWebviewViewProvider(this.state, "sidebar");
    this.state.webviewProviders.set("sidebar", sidebarProvider);

    const resolutionViewProvider = new KonveyorGUIWebviewViewProvider(this.state, "resolution");
    this.state.webviewProviders.set("resolution", resolutionViewProvider);

    [sidebarProvider, resolutionViewProvider].forEach((provider) =>
      this.onDidChangeData((data) => {
        provider.sendMessageToWebview(data);
      }),
    );

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        KonveyorGUIWebviewViewProvider.SIDEBAR_VIEW_TYPE,
        sidebarProvider,
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
      vscode.window.registerWebviewViewProvider(
        KonveyorGUIWebviewViewProvider.RESOLUTION_VIEW_TYPE,
        resolutionViewProvider,
        { webviewOptions: { retainContextWhenHidden: true } },
      ),
    );
  }

  private registerCommands(): void {
    registerAllCommands(this.state);
  }

  private registerLanguageProviders(context: vscode.ExtensionContext): void {
    const languagesToRegister = ["java"];

    for (const language of languagesToRegister) {
      context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(language, new ViolationCodeActionProvider(), {
          providedCodeActionKinds: ViolationCodeActionProvider.providedCodeActionKinds,
        }),
      );
    }
  }

  public getAnalyzerClient(): AnalyzerClient {
    return this.state.analyzerClient;
  }
}

let extension: VsCodeExtension | undefined;

export function activate(context: vscode.ExtensionContext): void {
  try {
    extension = new VsCodeExtension(context);
  } catch (error) {
    console.error("Failed to activate Konveyor extension:", error);
    vscode.window.showErrorMessage(`Failed to activate Konveyor extension: ${error}`);
  }
}
export function deactivate(): void {
  if (extension?.getAnalyzerClient()) {
    extension.getAnalyzerClient().stop();
  }
}
