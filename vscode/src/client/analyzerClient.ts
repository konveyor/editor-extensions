import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { basename } from "node:path";
import * as fs from "fs-extra";
import * as vscode from "vscode";
import * as rpc from "vscode-jsonrpc/node";
import {
  ChatMessage,
  ChatMessageType,
  EnhancedIncident,
  ExtensionData,
  RuleSet,
  Scope,
  ServerState,
  SolutionResponse,
  SolutionState,
  Violation,
} from "@editor-extensions/shared";
import { paths, fsPaths } from "../paths";
import { Extension } from "../helpers/Extension";
import { ExtensionState } from "../extensionState";
import { buildAssetPaths, AssetPaths } from "./paths";
import {
  getCacheDir,
  getConfigAnalyzerPath,
  getConfigCustomRules,
  getConfigKaiDemoMode,
  getConfigKaiRpcServerPath,
  getConfigLabelSelector,
  getConfigLoggingTraceMessageConnection,
  getConfigLogLevel,
  getConfigSolutionMaxEffort,
  getConfigMaxLLMQueries,
  getConfigSolutionMaxPriority,
  getConfigUseDefaultRulesets,
  getTraceEnabled,
  isAnalysisResponse,
  updateUseDefaultRuleSets,
} from "../utilities";
import { allIncidents } from "../issueView";
import { Immutable } from "immer";
import { countIncidentsOnPaths } from "../analysis";
import { KaiRpcApplicationConfig } from "./types";
import { getModelProvider, ModelProvider } from "./modelProvider";
import { tracer } from "./tracer";
import { v4 as uuidv4 } from "uuid";

const uid = (() => {
  let counter = 0;
  return (prefix: string = "") => `${prefix}${counter++}`;
})();

export class AnalyzerClient {
  private assetPaths: AssetPaths;
  private outputChannel: vscode.OutputChannel;
  private modelProvider: ModelProvider | null = null;
  private kaiRpcServer: ChildProcessWithoutNullStreams | null = null;
  private rpcConnection: rpc.MessageConnection | null = null;

  constructor(
    private extContext: vscode.ExtensionContext,
    private mutateExtensionData: (recipe: (draft: ExtensionData) => void) => void,
    private getExtStateData: () => Immutable<ExtensionData>,
  ) {
    this.assetPaths = buildAssetPaths(extContext);

    this.outputChannel = vscode.window.createOutputChannel("Konveyor-Analyzer");
    this.outputChannel.appendLine(
      `current asset paths: ${JSON.stringify(this.assetPaths, null, 2)}`,
    );
    this.outputChannel.appendLine(`extension paths: ${JSON.stringify(fsPaths(), null, 2)}`);

    // TODO: Push the serverState from "initial" to either "configurationNeeded" or "configurationReady"
  }

  private fireServerStateChange(state: ServerState) {
    this.mutateExtensionData((draft) => {
      draft.serverState = state;
      draft.isStartingServer = state === "starting";
      draft.isInitializingServer = state === "initializing";
    });
  }

  private fireAnalysisStateChange(flag: boolean) {
    this.mutateExtensionData((draft) => {
      draft.isAnalyzing = flag;
    });
  }

  private fireSolutionStateChange(state: SolutionState, message?: string, scope?: Scope) {
    this.mutateExtensionData((draft) => {
      draft.isFetchingSolution = state === "sent";
      draft.solutionState = state;

      if (state === "started") {
        draft.chatMessages = [];
        draft.solutionScope = scope;
      }
      if (message) {
        draft.chatMessages.push({
          messageToken: uid("m"),
          kind: ChatMessageType.String,
          value: { message },
        });
      }
    });
  }

  private addSolutionChatMessage(message: ChatMessage) {
    if (this.solutionState !== "sent") {
      return;
    }

    // TODO: The `message.chatToken` and `message.messageToken` fields are being ignored
    // TODO: for now.  They should influence the chatMessages array, but we don't have any
    // TODO: solid semantics for that quite yet.

    console.log("*** scm:", message);
    message.messageToken = message.messageToken ?? uid("scm");

    this.mutateExtensionData((draft) => {
      if (!draft.chatMessages) {
        draft.chatMessages = [];
      }
      draft.chatMessages.push(message);
    });
  }

  public get serverState(): ServerState {
    return this.getExtStateData().serverState;
  }

  public get analysisState(): boolean {
    return this.getExtStateData().isAnalyzing;
  }

  public get solutionState(): SolutionState {
    return this.getExtStateData().solutionState;
  }

  /**
   * Start the `kai-rpc-server`, wait until it is ready, and then setup the rpcConnection.
   *
   * Will only run if the sever state is: `stopped`, `configurationReady`
   *
   * Server state changes:
   *   - `starting`
   *   - `running`
   *   - `startFailed`
   *   - `stopped`: When the process exits (clean shutdown, aborted, killed, ...) the server
   *                states changes to `stopped` via the process event `exit`
   *
   * @throws Error if the process cannot be started
   */
  public async start(): Promise<void> {
    // TODO: Ensure serverState is stopped || configurationReady

    if (!this.canAnalyze()) {
      vscode.window.showErrorMessage(
        "Cannot start the kai rpc server due to missing configuration.",
      );
      return;
    }

    this.outputChannel.appendLine(`Starting the kai rpc server ...`);
    this.fireServerStateChange("starting");

    try {
      this.modelProvider = await getModelProvider(paths().settingsYaml);
      const [kaiRpcServer, pid] = await this.startProcessAndLogStderr();

      kaiRpcServer.on("exit", (code, signal) => {
        this.outputChannel.appendLine(`kai rpc server exited [signal: ${signal}, code: ${code}]`);
        this.fireServerStateChange("stopped");
      });

      this.kaiRpcServer = kaiRpcServer;
      this.outputChannel.appendLine(`kai rpc server successfully started [pid: ${pid}]`);
    } catch (e) {
      vscode.window
        .showErrorMessage(`kai rpc server failed to start`, "Open Output Console")
        .then((selection) => {
          if (selection === "Open Output Console") {
            this.outputChannel.show(true);
          }
        });
      this.outputChannel.appendLine(`kai rpc server start failed [error: ${e}]`);
      this.fireServerStateChange("startFailed");
      throw e;
    }

    // Set up the JSON-RPC connection
    this.rpcConnection = rpc.createMessageConnection(
      new rpc.StreamMessageReader(this.kaiRpcServer.stdout),
      new rpc.StreamMessageWriter(this.kaiRpcServer.stdin),
    );

    if (getConfigLoggingTraceMessageConnection()) {
      this.rpcConnection.trace(
        rpc.Trace.Verbose,
        tracer(`${basename(this.kaiRpcServer.spawnfile)} message trace`),
      );
    }

    /**
     * Handle server generated progress ChatMessages.
     */
    this.rpcConnection.onNotification("my_progress", (chatMessage: ChatMessage) => {
      this.addSolutionChatMessage(chatMessage);
    });

    this.rpcConnection.listen();
  }

  /**
   * Start the server process, wire the process's stderr to the output channel,
   * and wait (up to a maximum time) for the server to report itself ready.
   */
  protected async startProcessAndLogStderr(
    maxTimeToWaitUntilReady: number = 10_000,
  ): Promise<[ChildProcessWithoutNullStreams, number | undefined]> {
    // TODO: Ensure serverState is starting

    const serverPath = this.getKaiRpcServerPath();
    const serverArgs = this.getKaiRpcServerArgs();
    const serverEnv = this.getKaiRpcServerEnv();

    // this.outputChannel.appendLine(`server env: ${JSON.stringify(serverEnv, null, 2)}`);
    this.outputChannel.appendLine(`server cwd: ${paths().serverCwd.fsPath}`);
    this.outputChannel.appendLine(`server path: ${serverPath}`);
    this.outputChannel.appendLine(`server args:`);
    serverArgs.forEach((arg) => this.outputChannel.appendLine(`   ${arg}`));

    const kaiRpcServer = spawn(serverPath, serverArgs, {
      cwd: paths().serverCwd.fsPath,
      env: serverEnv,
    });

    const pid = await new Promise<number | undefined>((resolve, reject) => {
      kaiRpcServer.on("spawn", () => {
        this.outputChannel.appendLine(`kai rpc server has been spawned! [${kaiRpcServer.pid}]`);
        resolve(kaiRpcServer.pid);
      });

      kaiRpcServer.on("error", (err) => {
        const message = `error in process [${kaiRpcServer.spawnfile}]: ${err}`;
        this.outputChannel.appendLine(`[error] - ${message}`);
        reject(err);
      });
    });

    let seenServerIsReady = false;
    kaiRpcServer.stderr.on("data", (data) => {
      const asString: string = data.toString().trimEnd();
      this.outputChannel.appendLine(`${asString}`);

      if (!seenServerIsReady && asString.match(/kai-rpc-logger .*Started kai RPC Server/)) {
        seenServerIsReady = true;
        kaiRpcServer?.emit("serverReportsReady", pid);
      }
    });

    const untilReady = await Promise.race([
      new Promise<string>((resolve) => {
        if (seenServerIsReady) {
          resolve("ready");
        } else {
          kaiRpcServer!.on("serverReportsReady", (_pid) => {
            resolve("ready");
          });
        }
      }),
      setTimeout(maxTimeToWaitUntilReady, "timeout"),
    ]);

    if (untilReady === "timeout") {
      //TODO: Handle the case where the server is not ready to initialize
      // this.fireServerStateChange("readyToInitialize");

      this.outputChannel.appendLine(
        `waited ${maxTimeToWaitUntilReady}ms for the kai rpc server to be ready, continuing anyway`,
      );
    } else if (untilReady === "ready") {
      this.outputChannel.appendLine(`*** kai rpc server [${pid}] reports ready!`);
    }

    return [kaiRpcServer, pid];
  }

  protected isDemoMode(): boolean {
    const configDemoMode = getConfigKaiDemoMode();

    return configDemoMode !== undefined
      ? configDemoMode
      : !Extension.getInstance(this.extContext).isProductionMode;
  }

  /**
   * Request the server to __initialize__ with our analysis and solution configurations.
   *
   * Will only run if the sever state is: `readyToInitialize`
   *
   * Server state change: `running`
   */
  public async initialize(): Promise<void> {
    // TODO: Ensure serverState is readyToInitialize
    this.fireServerStateChange("initializing");

    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      this.fireServerStateChange("startFailed");

      return;
    }

    if (!this.modelProvider) {
      vscode.window.showErrorMessage("Server cannot initialize without being started");
      this.fireServerStateChange("startFailed");

      return;
    }

    // Define the initialize request parameters
    const initializeParams: KaiRpcApplicationConfig = {
      rootPath: paths().workspaceRepo.fsPath,
      modelProvider: this.modelProvider.modelProvider,

      logConfig: {
        logLevel: getConfigLogLevel(),
        fileLogLevel: getConfigLogLevel(),
        logDirPath: paths().serverLogs.fsPath,
      },

      demoMode: this.isDemoMode(),
      cacheDir: getCacheDir(),
      traceEnabled: getTraceEnabled(),

      // Paths to the Analyzer and jdt.ls
      analyzerLspRpcPath: this.getAnalyzerPath(),
      analyzerLspLspPath: this.assetPaths.jdtlsBin,
      analyzerLspRulesPaths: this.getRulesetsPath(),
      analyzerLspJavaBundlePaths: this.assetPaths.jdtlsBundleJars,
      analyzerLspDepLabelsPath: this.assetPaths.openSourceLabelsFile,

      // TODO(djzager): https://github.com/konveyor/editor-extensions/issues/202
      analyzerLspExcludedPaths: [vscode.Uri.joinPath(paths().workspaceRepo, ".vscode").fsPath],

      // TODO: Do we need to include `fernFlowerPath` to support the java decompiler?
      // analyzerLspFernFlowerPath: this.assetPaths.fernFlowerPath,

      // TODO: Once konveyor/kai#550 is resolved, analyzer configurations can be supported
      // analyzerIncidentLimit: getConfigIncidentLimit(),
      // analyzerContextLines: getConfigContextLines(),
      // analyzerCodeSnipLimit: getConfigCodeSnipLimit(),
      // analyzerAnalyzeKnownLibraries: getConfigAnalyzeKnownLibraries(),
      // analyzerAnalyzeDependencies: getConfigAnalyzeDependencies(),
    };

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Initializing Kai",
        cancellable: false,
      },
      async (progress) => {
        this.outputChannel.appendLine(
          `Sending 'initialize' request: ${JSON.stringify(initializeParams)}`,
        );
        progress.report({
          message: "Sending 'initialize' request to RPC Server",
        });

        const exitWatcher = new Promise<void>((_, reject) => {
          this.kaiRpcServer!.once("exit", (code, signal) => {
            reject(
              new Error(`kai-rpc-server exited unexpectedly (code=${code}, signal=${signal})`),
            );
          });
        });

        try {
          // Race the RPC call vs. the “server exited” watcher
          const response = await Promise.race([
            this.rpcConnection!.sendRequest<void>("initialize", initializeParams),
            exitWatcher,
          ]);

          this.outputChannel.appendLine(`'initialize' response: ${JSON.stringify(response)}`);
          this.outputChannel.appendLine(`kai rpc server is initialized!`);
          this.fireServerStateChange("running");
          progress.report({ message: "Kai RPC Server is initialized." });
        } catch (err) {
          // The race either saw a process exit or an RPC-level failure
          this.outputChannel.appendLine(`kai rpc server failed to initialize [err: ${err}]`);
          progress.report({ message: "Kai initialization failed!" });
          this.fireServerStateChange("startFailed");
        }
      },
    );
  }

  /**
   * Request the server to __shutdown__
   *
   * Will only run if the sever state is: `running`, `initialized`
   */
  public async shutdown(): Promise<void> {
    // TODO: Ensure serverState is running || initialized
    try {
      this.outputChannel.appendLine(`Requesting kai rpc server shutdown...`);
      await this.rpcConnection?.sendRequest("shutdown", {});
    } catch (err: any) {
      this.outputChannel.appendLine(`Error during shutdown: ${err.message}`);
      vscode.window.showErrorMessage("Shutdown failed. See the output channel for details.");
    }
  }

  /**
   * Shutdown and, if necessary, hard stops the server.
   *
   * Will run from any server state, and any running server process will be killed.
   *
   * Server state change: `stopping`
   */
  public async stop(): Promise<void> {
    const exitPromise = this.kaiRpcServer
      ? new Promise<string>((resolve) => {
          if (this.kaiRpcServer!.exitCode !== null) {
            resolve(`already exited, code: ${this.kaiRpcServer!.exitCode}`);
          } else {
            this.kaiRpcServer?.on("exit", () => {
              resolve("exited");
            });
          }
        })
      : Promise.resolve("not started");

    this.outputChannel.appendLine(`Stopping the kai rpc server...`);
    this.fireServerStateChange("stopping");
    await this.shutdown();

    this.outputChannel.appendLine(`Closing connections to the kai rpc server...`);
    this.rpcConnection?.end();
    this.rpcConnection?.dispose();
    this.rpcConnection = null;

    const reason = await Promise.race([setTimeout(5_000, "timeout"), exitPromise]);
    this.outputChannel.appendLine(`kai rpc server stopping [reason: ${reason}]`);
    if (this.kaiRpcServer?.exitCode === null) {
      this.kaiRpcServer.kill();
    }
    this.kaiRpcServer = null;
    this.outputChannel.appendLine(`kai rpc server stopped`);
  }

  public isServerRunning(): boolean {
    return !!this.kaiRpcServer && !this.kaiRpcServer.killed;
  }

  /**
   * Request the server to __Analyze__
   *
   * Will only run if the sever state is: `running`
   */
  public async runAnalysis(filePaths?: vscode.Uri[]): Promise<void> {
    // TODO: Ensure serverState is running

    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Running Analysis",
        cancellable: true,
      },
      async (progress, token) => {
        try {
          progress.report({ message: "Running..." });
          this.fireAnalysisStateChange(true);

          const requestParams = {
            label_selector: getConfigLabelSelector(),
            included_paths: filePaths?.map((uri) => uri.fsPath),
            reset_cache: !(filePaths && filePaths.length > 0),
          };
          this.outputChannel.appendLine(
            `Sending 'analysis_engine.Analyze' request with params: ${JSON.stringify(
              requestParams,
            )}`,
          );

          if (token.isCancellationRequested) {
            this.outputChannel.appendLine("Analysis was canceled by the user.");
            this.fireAnalysisStateChange(false);
            return;
          }

          const cancellationPromise = new Promise((resolve) => {
            token.onCancellationRequested(() => {
              resolve({ isCancelled: true });
            });
          });

          const { response: rawResponse, isCancelled }: any = await Promise.race([
            this.rpcConnection!.sendRequest("analysis_engine.Analyze", requestParams).then(
              (response) => ({ response }),
            ),
            cancellationPromise,
          ]);

          if (isCancelled) {
            this.outputChannel.appendLine("Analysis operation was canceled.");
            vscode.window.showInformationMessage("Analysis was canceled.");
            this.fireAnalysisStateChange(false);
            return;
          }
          const isResponseWellFormed = isAnalysisResponse(rawResponse?.Rulesets);
          const ruleSets: RuleSet[] = isResponseWellFormed ? rawResponse?.Rulesets : [];
          const summary = isResponseWellFormed
            ? {
                wellFormed: true,
                rawIncidentCount: ruleSets
                  .flatMap((r) => Object.values<Violation>(r.violations ?? {}))
                  .flatMap((v) => v.incidents ?? []).length,
                incidentCount: allIncidents(ruleSets).length,
                partialAnalysis: filePaths
                  ? {
                      incidentsBefore: countIncidentsOnPaths(
                        this.getExtStateData().ruleSets,
                        filePaths.map((uri) => uri.toString()),
                      ),
                      incidentsAfter: countIncidentsOnPaths(
                        ruleSets,
                        filePaths.map((uri) => uri.toString()),
                      ),
                    }
                  : {},
              }
            : { wellFormed: false };

          this.outputChannel.appendLine(`Response received. Summary: ${JSON.stringify(summary)}`);

          // Handle the result
          if (!isResponseWellFormed) {
            vscode.window.showErrorMessage(
              "Analysis completed, but received results are not well formed.",
            );
            this.fireAnalysisStateChange(false);
            return;
          }
          if (ruleSets.length === 0) {
            vscode.window.showInformationMessage("Analysis completed. No incidents were found.");
            this.fireAnalysisStateChange(false);
            return;
          }

          vscode.commands.executeCommand("konveyor.loadRuleSets", ruleSets, filePaths);
          progress.report({ message: "Results processed!" });
          vscode.window.showInformationMessage("Analysis completed successfully!");
        } catch (err: any) {
          this.outputChannel.appendLine(`Error during analysis: ${err.message}`);
          vscode.window.showErrorMessage("Analysis failed. See the output channel for details.");
        }
        this.fireAnalysisStateChange(false);
      },
    );
  }

  /**
   * Request the server to __getCodeplanAgentSolution__
   *
   * Will only run if the sever state is: `running`
   */
  public async getSolution(state: ExtensionState, incidents: EnhancedIncident[]): Promise<void> {
    // TODO: Ensure serverState is running

    this.fireSolutionStateChange("started", "Checking server state...", { incidents });

    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      this.fireSolutionStateChange("failedOnStart", "RPC connection is not established.");
      return;
    }

    const maxPriority = getConfigSolutionMaxPriority();
    const maxDepth = getConfigSolutionMaxEffort();
    const maxIterations = getConfigMaxLLMQueries();

    try {
      // generate a uuid for the request
      const chatToken = uuidv4();

      const request = {
        file_path: "",
        incidents,
        max_priority: maxPriority,
        max_depth: maxDepth,
        max_iterations: maxIterations,
        chat_token: chatToken,
      };

      this.outputChannel.appendLine(
        `getCodeplanAgentSolution request: ${JSON.stringify(request, null, 2)}`,
      );

      this.fireSolutionStateChange("sent", "Waiting for the resolution...");

      const _m: ChatMessage[] = [];
      const i = setInterval(() => {
        if (_m.length > 0) {
          this.addSolutionChatMessage(_m.shift()!);
        }
      }, 1000);
      const response: SolutionResponse = await this.rpcConnection!.sendRequest(
        "getCodeplanAgentSolution",
        request,
      );
      clearInterval(i);

      this.fireSolutionStateChange("received", "Received response...");
      vscode.commands.executeCommand("konveyor.loadSolution", response, {
        incidents,
      });
    } catch (err: any) {
      this.outputChannel.appendLine(`Error during getSolution: ${err.message}`);
      vscode.window.showErrorMessage(
        "Failed to provide resolutions. See the output channel for details.",
      );
      this.fireSolutionStateChange(
        "failedOnSending",
        `Failed to provide resolutions. Encountered error: ${err.message}. See the output channel for details.`,
      );
    }
  }

  public canAnalyze(): boolean {
    return !!getConfigLabelSelector() && this.getRulesetsPath().length !== 0;
  }

  public async canAnalyzeInteractive(): Promise<boolean> {
    const labelSelector = getConfigLabelSelector();

    if (!labelSelector) {
      const selection = await vscode.window.showErrorMessage(
        "LabelSelector is not configured. Please configure it before starting the analyzer.",
        "Select Sources and Targets",
        "Configure LabelSelector",
        "Cancel",
      );

      switch (selection) {
        case "Select Sources and Targets":
          await vscode.commands.executeCommand("konveyor.configureSourcesTargets");
          break;
        case "Configure LabelSelector":
          await vscode.commands.executeCommand("konveyor.configureLabelSelector");
          break;
      }
      return false;
    }

    if (this.getRulesetsPath().length === 0) {
      const selection = await vscode.window.showWarningMessage(
        "Default rulesets are disabled and no custom rules are defined. Please choose an option to proceed.",
        "Enable Default Rulesets",
        "Configure Custom Rules",
        "Cancel",
      );

      switch (selection) {
        case "Enable Default Rulesets":
          await updateUseDefaultRuleSets(true);
          vscode.window.showInformationMessage("Default rulesets have been enabled.");
          break;
        case "Configure Custom Rules":
          await vscode.commands.executeCommand("konveyor.configureCustomRules");
          break;
      }
      return false;
    }

    return true;
  }

  public getAnalyzerPath(): string {
    const path = getConfigAnalyzerPath() || this.assetPaths.kaiAnalyzer;

    if (!fs.existsSync(path)) {
      const message = `Analyzer binary doesn't exist at ${path}`;
      this.outputChannel.appendLine(`Error: ${message}`);
      vscode.window.showErrorMessage(message);
    }

    return path;
  }

  /**
   * Build the process environment variables to be setup for the kai rpc server process.
   */
  public getKaiRpcServerEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.modelProvider!.env,
    };
  }

  public getKaiRpcServerPath(): string {
    const path = getConfigKaiRpcServerPath() || this.assetPaths.kaiRpcServer;

    if (!fs.existsSync(path)) {
      const message = `RPC Server binary doesn't exist at ${path}`;
      this.outputChannel.appendLine(`Error: ${message}`);
      vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    return path;
  }

  public getKaiRpcServerArgs(): string[] {
    return [
      "--log-level",
      getConfigLogLevel(),
      "--file-log-level",
      getConfigLogLevel(),
      "--log-dir-path",
      paths().serverLogs.fsPath,
    ].filter(Boolean);
  }

  public getRulesetsPath(): string[] {
    return [
      getConfigUseDefaultRulesets() && this.assetPaths.rulesets,
      ...getConfigCustomRules(),
    ].filter(Boolean);
  }
}
