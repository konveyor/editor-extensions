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
  getEffortValue,
  RuleSet,
  Scope,
  ServerState,
  SolutionEffortLevel,
  SolutionResponse,
  SolutionState,
  Violation,
} from "@editor-extensions/shared";
import { paths, fsPaths, ignoresToExcludedPaths } from "../paths";
import { Extension } from "../helpers/Extension";
import { ExtensionState } from "../extensionState";
import { buildAssetPaths, AssetPaths } from "./paths";
import {
  getConfigAnalyzerPath,
  getConfigCustomRules,
  getConfigKaiDemoMode,
  getConfigLabelSelector,
  getConfigLoggingTraceMessageConnection,
  getConfigLogLevel,
  getConfigMaxLLMQueries,
  getConfigSolutionMaxPriority,
  getConfigUseDefaultRulesets,
  isAnalysisResponse,
  updateUseDefaultRuleSets,
} from "../utilities";
import { allIncidents } from "../issueView";
import { Immutable } from "immer";
import { countIncidentsOnPaths } from "../analysis";
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
  private analyzerRpcServer: ChildProcessWithoutNullStreams | null = null;
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
      this.outputChannel.appendLine(`serverState change from [${draft.serverState}] to [${state}]`);
      draft.serverState = state;
      draft.isStartingServer = state === "starting";
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
          timestamp: new Date().toISOString(),
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
      draft.chatMessages.push({
        ...message,
        timestamp: new Date().toISOString(),
      });
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
   * Start the `kai-analyzer-rpc-server`, wait until it is ready, and then setup the rpcConnection.
   *
   * Will only run if the sever state is: `stopped`, `configurationReady`
   *
   * Server state changes:
   *   - `starting`
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

    this.outputChannel.appendLine(`Starting the analyzer rpc server ...`);
    this.fireServerStateChange("starting");

    const pipeName = rpc.generateRandomPipeName();
    // create transport for analyzer rpc server
    const transport = await rpc.createClientPipeTransport(pipeName);
    const protocol = await transport.onConnected();
    const transports = { reader: protocol[0], writer: protocol[1] };

    try {
      this.modelProvider = await getModelProvider(paths().settingsYaml);
      const [analyzerRpcServer, pid] = await this.startProcessAndLogStderr(pipeName);

      this.analyzerRpcServer = analyzerRpcServer;
      this.outputChannel.appendLine(`analyzer rpc server successfully started [pid: ${pid}]`);
    } catch (e) {
      vscode.window
        .showErrorMessage(`analyzer rpc server failed to start`, "Open Output Console")
        .then((selection) => {
          if (selection === "Open Output Console") {
            this.outputChannel.show(true);
          }
        });
      this.outputChannel.appendLine(`analyzer rpc server start failed [error: ${e}]`);
      this.fireServerStateChange("startFailed");
      throw e;
    }

    try {
      // create the rpc connection
      this.rpcConnection = rpc.createMessageConnection(transports.reader, transports.writer);
    } catch (e) {
      this.outputChannel.appendLine(
        `failed to setup connection to analyzer rpc server [error: ${e}]`,
      );
      this.fireServerStateChange("startFailed");
      this.stop();
      throw e;
    }

    this.rpcConnection.onNotification(function (method: string, params: any) {
      console.log("got " + method + " with params " + params);
    });
    this.rpcConnection.listen();
    this.rpcConnection.sendNotification("start", { type: "start" });

    if (getConfigLoggingTraceMessageConnection()) {
      this.rpcConnection.trace(
        rpc.Trace.Verbose,
        tracer(`${basename(this.analyzerRpcServer.spawnfile)} message trace`),
      );
    }

    /**
     * TODO (pgaikwad): this needs to change when we
     * move llm calls to the IDE
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
    pipeName: string,
    maxTimeToWaitUntilReady: number = 30_000,
  ): Promise<[ChildProcessWithoutNullStreams, number | undefined]> {
    const serverPath = this.getAnalyzerPath();
    const serverArgs = this.getAnalyzerServerArgs(pipeName);
    // TODO (pgaikwad): address the env vars
    const serverEnv = this.getKaiRpcServerEnv();

    // this.outputChannel.appendLine(`server env: ${JSON.stringify(serverEnv, null, 2)}`);
    this.outputChannel.appendLine(`server cwd: ${paths().serverCwd.fsPath}`);
    this.outputChannel.appendLine(`server path: ${serverPath}`);
    this.outputChannel.appendLine(`server args:`);
    serverArgs.forEach((arg) => this.outputChannel.appendLine(`   ${arg}`));

    const analyzerRpcServer = spawn(serverPath, serverArgs, {
      cwd: paths().serverCwd.fsPath,
      env: serverEnv,
    });

    let processStarted = false;

    analyzerRpcServer.on("error", (err) => {
      const message = `error in process [${analyzerRpcServer.spawnfile}]: ${err}`;
      this.outputChannel.appendLine(`[error] - ${message}`);
      analyzerRpcServer?.emit("startFailed");
      this.fireServerStateChange("startFailed");
    });

    analyzerRpcServer.on("exit", (code, signal) => {
      this.outputChannel.appendLine(
        `analyzer rpc server exited [signal: ${signal}, code: ${code}]`,
      );
      if (!processStarted) {
        analyzerRpcServer?.emit("startFailed");
        this.fireServerStateChange("startFailed");
      } else {
        this.fireServerStateChange("stopped");
        vscode.window.showInformationMessage("Analyzer rpc server has exited!");
      }
    });

    let seenServerIsReady = false;
    analyzerRpcServer.stderr.on("data", (data) => {
      const asString: string = data.toString().trimEnd();
      this.outputChannel.appendLine(`${asString}`);

      if (!seenServerIsReady && asString.match(/.*Starting Server/)) {
        seenServerIsReady = true;
        processStarted = true;
        analyzerRpcServer?.emit("serverReportsReady", analyzerRpcServer.pid);
        this.fireServerStateChange("running");
      }
    });

    const readyOrTimeout = await Promise.race([
      new Promise<string>((resolve) => {
        if (seenServerIsReady) {
          resolve("ready");
        }
        analyzerRpcServer!.on("serverReportsReady", (_pid) => {
          resolve("ready");
        });
        analyzerRpcServer!.on("startFailed", (_pid) => {
          resolve("failed");
        });
      }),
      setTimeout(maxTimeToWaitUntilReady, "timeout"),
    ]);

    const pid = analyzerRpcServer?.pid;

    switch (readyOrTimeout) {
      case "timeout":
        this.outputChannel.appendLine(
          `waited ${maxTimeToWaitUntilReady}ms for the analyzer rpc server to be ready, exiting...`,
        );
        throw new Error("Analyzer rpc server failed to start");
      case "ready":
        this.outputChannel.appendLine(`*** analyzer rpc server [${pid}] reports ready!`);
        break;
      default:
        this.outputChannel.appendLine(`*** analyzer rpc server [${pid}] failed to start!`);
        throw new Error("Analyzer rpc server failed to start");
    }

    return [analyzerRpcServer, pid];
  }

  protected isDemoMode(): boolean {
    const configDemoMode = getConfigKaiDemoMode();

    return configDemoMode !== undefined
      ? configDemoMode
      : !Extension.getInstance(this.extContext).isProductionMode;
  }

  /**
   * Request the server to __shutdown__
   *
   * Will only run if the sever state is: `running`, `initialized`
   */
  public async shutdown(): Promise<void> {
    if (this.serverState !== "running") {
      return;
    }

    try {
      this.outputChannel.appendLine(`Requesting kai rpc server shutdown...`);
      await this.rpcConnection?.sendRequest("analysis_engine.Stop", {});
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
    const exitPromise = this.analyzerRpcServer
      ? new Promise<string>((resolve) => {
          if (this.analyzerRpcServer!.exitCode !== null) {
            resolve(`already exited, code: ${this.analyzerRpcServer!.exitCode}`);
          } else {
            this.analyzerRpcServer?.on("exit", () => {
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
    if (this.analyzerRpcServer?.exitCode === null) {
      this.analyzerRpcServer.kill();
    }
    this.analyzerRpcServer = null;
    this.outputChannel.appendLine(`kai rpc server stopped`);
    this.fireServerStateChange("stopped");
  }

  public isServerRunning(): boolean {
    return !!this.analyzerRpcServer && !this.analyzerRpcServer.killed;
  }

  /**
   * Request the server to __Analyze__
   *
   * Will only run if the sever state is: `running`
   */
  public async runAnalysis(filePaths?: vscode.Uri[]): Promise<void> {
    if (this.serverState !== "running" || !this.rpcConnection) {
      this.outputChannel.appendLine("analyzer rpc server is not running, skipping runAnalysis.");
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
            excluded_paths: ignoresToExcludedPaths(),
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
          }

          vscode.commands.executeCommand("konveyor.loadRuleSets", ruleSets);
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
  public async getSolution(
    state: ExtensionState,
    incidents: EnhancedIncident[],
    effort: SolutionEffortLevel,
  ): Promise<void> {
    this.fireSolutionStateChange("started", "Checking server state...", { incidents, effort });

    if (this.serverState !== "running" || !this.rpcConnection) {
      this.outputChannel.appendLine("kai rpc server is not running, skipping getSolution.");
      this.fireSolutionStateChange("failedOnStart", "kai rpc server is not running");
      return;
    }

    const maxPriority = getConfigSolutionMaxPriority();
    const maxDepth = getEffortValue(effort);
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

      const response: SolutionResponse = await this.rpcConnection!.sendRequest(
        "getCodeplanAgentSolution",
        request,
      );

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

  protected getAnalyzerPath(): string {
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
  protected getKaiRpcServerEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.modelProvider!.env,
    };
  }

  //TODO (pgaikwad) - add log level to analyzer server
  protected getAnalyzerServerArgs(pipeName: string): string[] {
    return [
      "--pipePath",
      pipeName,
      "--source-directory",
      paths().workspaceRepo.fsPath,
      "--log-file",
      vscode.Uri.joinPath(paths().serverLogs, "analyzer.log").fsPath,
      "--lspServerPath",
      this.assetPaths.jdtlsBin,
      "--bundles",
      this.assetPaths.jdtlsBundleJars.join(","),
      "--depOpenSourceLabelsFile",
      this.assetPaths.openSourceLabelsFile,
      "--log-level",
      getConfigLogLevel(),
      ...this.getRulesetsPath()
        .flatMap((path) => ["--rules", path])
        .filter(Boolean),
    ].filter(Boolean);
  }

  protected getRulesetsPath(): string[] {
    return [
      getConfigUseDefaultRulesets() && this.assetPaths.rulesets,
      ...getConfigCustomRules(),
    ].filter(Boolean);
  }
}
