import * as vscode from "vscode";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import { registerAllCommands as registerAllCommands } from "./commands";
import { ExtensionState } from "./extensionState";
import { ExtensionData } from "@editor-extensions/shared";
import { SimpleInMemoryCache } from "@editor-extensions/agentic";
import { ViolationCodeActionProvider } from "./ViolationCodeActionProvider";
import { AnalyzerClient } from "./client/analyzerClient";
import { SolutionServerClient } from "@editor-extensions/agentic";
import { KonveyorFileModel, registerDiffView } from "./diffView";
import { MemFS } from "./data";
import { Immutable, produce } from "immer";
import { registerAnalysisTrigger } from "./analysis";
import { IssuesModel, registerIssueView } from "./issueView";
import { ExtensionPaths, ensurePaths, paths } from "./paths";
import { copySampleProviderSettings } from "./utilities/fileUtils";
import {
  getConfigSolutionMaxEffortLevel,
  getConfigSolutionServerEnabled,
  getConfigSolutionServerUrl,
  updateAnalysisConfig,
} from "./utilities";
import { getBundledProfiles } from "./utilities/profiles/bundledProfiles";
import { getUserProfiles } from "./utilities/profiles/profileService";
import { DiagnosticTaskManager } from "./taskManager/taskManager";

class VsCodeExtension {
  private state: ExtensionState;
  private data: Immutable<ExtensionData>;
  private _onDidChange = new vscode.EventEmitter<Immutable<ExtensionData>>();
  readonly onDidChangeData = this._onDidChange.event;
  private listeners: vscode.Disposable[] = [];

  constructor(
    public readonly paths: ExtensionPaths,
    public readonly context: vscode.ExtensionContext,
  ) {
    this.data = produce(
      {
        localChanges: [],
        ruleSets: [],
        enhancedIncidents: [],
        resolutionPanelData: undefined,
        isAnalyzing: false,
        isFetchingSolution: false,
        isStartingServer: false,
        isInitializingServer: false,
        isAnalysisScheduled: false,
        isContinueInstalled: false,
        solutionData: undefined,
        serverState: "initial",
        solutionScope: undefined,
        workspaceRoot: paths.workspaceRepo.toString(true),
        chatMessages: [],
        solutionState: "none",
        solutionEffort: getConfigSolutionMaxEffortLevel(),
        analysisConfig: {
          labelSelectorValid: false,
          genAIConfigured: false,
          genAIKeyMissing: false,
          genAIUsingDefault: false,
          customRulesConfigured: false,
        },
        activeProfileId: "",
        profiles: [],
      },
      () => {},
    );
    const getData = () => this.data;
    const setData = (data: Immutable<ExtensionData>) => {
      this.data = data;
      this._onDidChange.fire(this.data);
    };
    const mutateData = (recipe: (draft: ExtensionData) => void): Immutable<ExtensionData> => {
      const data = produce(getData(), recipe);
      setData(data);
      return data;
    };

    const taskManager = new DiagnosticTaskManager();

    this.state = {
      analyzerClient: new AnalyzerClient(context, mutateData, getData, taskManager),
      solutionServerClient: new SolutionServerClient(
        getConfigSolutionServerUrl(),
        getConfigSolutionServerEnabled(),
      ),
      webviewProviders: new Map<string, KonveyorGUIWebviewViewProvider>(),
      extensionContext: context,
      diagnosticCollection: vscode.languages.createDiagnosticCollection("konveyor"),
      memFs: new MemFS(),
      fileModel: new KonveyorFileModel(),
      issueModel: new IssuesModel(),
      kaiFsCache: new SimpleInMemoryCache(),
      taskManager,
      get data() {
        return getData();
      },
      mutateData,
    };
  }

  public async initialize(): Promise<void> {
    try {
      this.checkWorkspace();

      const bundled = getBundledProfiles();
      const user = getUserProfiles(this.context);
      const allProfiles = [...bundled, ...user];

      const storedActiveId = this.context.workspaceState.get<string>("activeProfileId");

      const matchingProfile = allProfiles.find((p) => p.id === storedActiveId);

      const activeProfileId =
        matchingProfile?.id ?? (allProfiles.length > 0 ? allProfiles[0].id : null);

      this.state.mutateData((draft) => {
        draft.profiles = allProfiles;
        draft.activeProfileId = activeProfileId;
        updateAnalysisConfig(draft, paths().settingsYaml.fsPath);
      });

      this.registerWebviewProvider();
      this.listeners.push(this.onDidChangeData(registerDiffView(this.state)));
      this.listeners.push(this.onDidChangeData(registerIssueView(this.state)));
      this.registerCommands();
      this.registerLanguageProviders();
      this.checkContinueInstalled();
      this.state.solutionServerClient.connect().catch((error) => {
        console.error("Error connecting to solution server:", error);
      });

      // Listen for extension changes to update Continue installation status
      this.listeners.push(
        vscode.extensions.onDidChange(() => {
          this.checkContinueInstalled();
        }),
      );

      registerAnalysisTrigger(this.listeners, this.state);

      this.listeners.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
          if (doc.uri.fsPath === paths().settingsYaml.fsPath) {
            this.state.mutateData((draft) => {
              updateAnalysisConfig(draft, paths().settingsYaml.fsPath);
            });
          }
        }),
      );

      this.listeners.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
          console.log("Configuration modified!");

          if (event.affectsConfiguration("konveyor.kai.getSolutionMaxEffort")) {
            console.log("Effort modified!");
            const effort = getConfigSolutionMaxEffortLevel();
            this.state.mutateData((draft) => {
              draft.solutionEffort = effort;
            });
          }
          if (
            event.affectsConfiguration("konveyor.solutionServer.url") ||
            event.affectsConfiguration("konveyor.solutionServer.enabled")
          ) {
            console.log("Solution server configuration modified!");
            vscode.window
              .showInformationMessage(
                "Solution server configuration has changed. Please restart the Konveyor extension for changes to take effect.",
                "Restart Now",
              )
              .then((selection) => {
                if (selection === "Restart Now") {
                  vscode.commands.executeCommand("workbench.action.reloadWindow");
                }
              });
          }
        }),
      );

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

  private registerWebviewProvider(): void {
    const sidebarProvider = new KonveyorGUIWebviewViewProvider(this.state, "sidebar");
    const resolutionViewProvider = new KonveyorGUIWebviewViewProvider(this.state, "resolution");
    const profilesViewProvider = new KonveyorGUIWebviewViewProvider(this.state, "profiles");

    this.state.webviewProviders.set("sidebar", sidebarProvider);
    this.state.webviewProviders.set("resolution", resolutionViewProvider);
    this.state.webviewProviders.set("profiles", profilesViewProvider);

    [sidebarProvider, resolutionViewProvider, profilesViewProvider].forEach((provider) =>
      this.onDidChangeData((data) => {
        provider.sendMessageToWebview(data);
      }),
    );

    this.context.subscriptions.push(
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
      vscode.window.registerWebviewViewProvider(
        KonveyorGUIWebviewViewProvider.PROFILES_VIEW_TYPE,
        profilesViewProvider,
        {
          webviewOptions: { retainContextWhenHidden: true },
        },
      ),
    );
  }

  private registerCommands(): void {
    registerAllCommands(this.state);
  }

  private registerLanguageProviders(): void {
    const documentSelectors: vscode.DocumentSelector = [
      // Language IDs
      "java",
      "yaml",
      "properties",
      "groovy", // for Gradle files
      // Specific file patterns
      { pattern: "**/pom.xml" },
      { pattern: "**/build.gradle" },
      { pattern: "**/build.gradle.kts" },
    ];

    this.context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        documentSelectors,
        new ViolationCodeActionProvider(this.state),
        {
          providedCodeActionKinds: ViolationCodeActionProvider.providedCodeActionKinds,
        },
      ),
    );
  }

  private checkContinueInstalled(): void {
    const continueExt = vscode.extensions.getExtension("Continue.continue");
    this.state.mutateData((draft) => {
      draft.isContinueInstalled = !!continueExt;
    });
  }

  public async dispose() {
    await this.state.analyzerClient?.stop();
    await this.state.solutionServerClient?.disconnect().catch((error) => {
      console.error("Error disconnecting from solution server:", error);
    });
    const disposables = this.listeners.splice(0, this.listeners.length);
    for (const disposable of disposables) {
      disposable.dispose();
    }
  }
}

let extension: VsCodeExtension | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  try {
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("Please open a workspace folder before using this extension.");
      return;
    }

    const paths = await ensurePaths(context);
    await copySampleProviderSettings();

    extension = new VsCodeExtension(paths, context);
    await extension.initialize();
  } catch (error) {
    await extension?.dispose();
    extension = undefined;
    console.error("Failed to activate Konveyor extension:", error);
    vscode.window.showErrorMessage(`Failed to activate Konveyor extension: ${error}`);
  }
}

export async function deactivate(): Promise<void> {
  await extension?.dispose();
}
