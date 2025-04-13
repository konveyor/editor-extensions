import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import path from "node:path";
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
import { paths, fsPaths } from "../paths";
import { Extension } from "../helpers/Extension";
import { ExtensionState } from "../extensionState";
import { buildAssetPaths, AssetPaths } from "./paths";
import {
  getCacheDir,
  getConfigAnalyzerPath,
  getConfigKaiDemoMode,
  getConfigKaiRpcServerPath,
  getConfigLoggingTraceMessageConnection,
  getConfigLogLevel,
  getConfigMaxLLMQueries,
  getConfigSolutionMaxPriority,
  getTraceEnabled,
  isAnalysisResponse,
} from "../utilities";
import { allIncidents } from "../issueView";
import { Immutable } from "immer";
import { countIncidentsOnPaths } from "../analysis";
import { getModelProvider, ModelProvider } from "./modelProvider";
import { v4 as uuidv4 } from "uuid";
import { createConnection, Socket } from "node:net";

const uid = (() => {
  let counter = 0;
  return (prefix: string = "") => `${prefix}${counter++}`;
})();

export class WorksapceCommandParams {
  public command: string | undefined;
  public arguments: any[] | undefined;
}

export class AnalyzerClient {
  private assetPaths: AssetPaths;
  private outputChannel: vscode.OutputChannel;
  private modelProvider: ModelProvider | null = null;
  private kaiRpcServer: ChildProcessWithoutNullStreams | null = null;
  private rpcConnection: rpc.MessageConnection | null = null;
  private analyzerRpcServer: ChildProcessWithoutNullStreams | null = null;
  private analyzerRpcConnection?: rpc.MessageConnection | null;

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
   * Start the `kai-rpc-server`, wait until it is ready, and then setup the rpcConnection.
   *
   * Will only run if the sever state is: `stopped`, `configurationReady`
   *
   * Server state changes:
   *   - `starting`
   *   - `readyToInitialize`
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

    this.outputChannel.appendLine("Starting kai analyzer rpc");

    this.outputChannel.appendLine(`Starting the kai rpc server ...`);
    this.fireServerStateChange("starting");

    this.modelProvider = await getModelProvider(paths().settingsYaml);
    const pipeName = rpc.generateRandomPipeName();
    const [analyzerRpcServer, analyzerPid] = await this.startAnalysisServer(pipeName);
    analyzerRpcServer.on("exit", (code, signal) => {
      this.outputChannel.appendLine(
        `analyzer rpc server exited [signal: ${signal}, code: ${code}]`,
      );
      this.fireServerStateChange("stopped");
    });
    this.analyzerRpcServer = analyzerRpcServer;
    this.outputChannel.appendLine(`analyzer rpc server successfully started [pid: ${analyzerPid}]`);

    const socket: Socket = await this.getSocket(pipeName);
    socket.addListener("connectionAttempt", () => {
      this.outputChannel.appendLine("connectAttempt");
    });
    socket.addListener("connectionAttemptFailed", () => {
      this.outputChannel.appendLine("connectAttemptFailed");
    });
    socket.on("data", (data) => {
      this.outputChannel.appendLine("herelasdkjfalskdfjasld;kfjhewe" + data.toString());
    });
    const reader = new rpc.SocketMessageReader(socket, "utf-8");
    const writer = new rpc.SocketMessageWriter(socket, "utf-8");

    reader.onClose(() => {
      this.outputChannel.appendLine("reader-closed");
    });
    reader.onError(() => {
      this.outputChannel.appendLine("reader-onerr");
    });
    writer.onClose(() => {
      this.outputChannel.appendLine("writer-closed");
    });
    writer.onError((e) => {
      this.outputChannel.appendLine("writer-onerr" + e?.toLocaleString());
    });
    this.analyzerRpcConnection = await rpc.createMessageConnection(reader, writer);
    this.analyzerRpcConnection.trace(rpc.Trace.Messages, console, false);
    this.analyzerRpcConnection.onUnhandledNotification((e) => {
      this.outputChannel.appendLine("here");
    });

    this.analyzerRpcConnection.onClose(() =>
      this.outputChannel.appendLine("HEHRHEHRHERHEHRHERHEHR"),
    );
    this.analyzerRpcConnection.onRequest((method, params) => {
      this.outputChannel.appendLine("got " + method + " with params " + params);
    });

    this.analyzerRpcConnection.onNotification("started", (v: []) => {
      this.outputChannel.appendLine("got started: " + v);
    });
    this.analyzerRpcConnection.onNotification((method: string, params: any) => {
      console.log("got " + method + " with params " + params);
      this.outputChannel.appendLine("got " + method + " with params " + params);
    });
    this.analyzerRpcConnection.onUnhandledNotification((e) => {
      this.outputChannel.appendLine("got: " + e.method + " " + e.params);
    });
    this.analyzerRpcConnection.onRequest(
      "workspace/executeCommand",
      (params: WorksapceCommandParams) => {
        this.outputChannel.appendLine("pramas" + JSON.stringify(params));
        return vscode.commands
          .executeCommand("java.execute.workspaceCommand", params.command, params.arguments![0])
          .then((res) => {
            this.outputChannel.appendLine(JSON.stringify(res));
            return res;
          });
      },
    );
    this.analyzerRpcConnection.onError((e) => {
      this.outputChannel.appendLine("hererere" + e);
    });
    this.analyzerRpcConnection.listen();
    this.analyzerRpcConnection.sendNotification("start", { type: "start" });

    this.fireServerStateChange("readyToInitialize");
  }

  protected async getSocket(pipeName: string): Promise<Socket> {
    const s = createConnection(pipeName);
    let ready = false;
    s.on("ready", () => {
      this.outputChannel.appendLine("got ready message");
      ready = true;
    });
    while ((s.connecting || !s.readable) && !ready) {
      await setTimeout(200);
      if (!s.connecting && s.readable) {
        break;
      }
      if (!s.connecting) {
        s.connect(pipeName);
      }
    }
    if (s.readable) {
      return s;
    } else {
      throw Error("unable to connect");
    }
  }

  protected startAnalysisServer(
    pipeName: string,
    maxTimeToWaitUntilReady: number = 30_000,
  ): [ChildProcessWithoutNullStreams, number | undefined] {
    const analyzerPath = this.getAnalyzerPath();
    const serverEnv = this.getKaiRpcServerEnv();
    const analyzerLspRulesPaths = this.getRulesetsPath().join(",");
    const location = paths().workspaceRepo.fsPath;
    const logs = path.join(paths().serverLogs.fsPath, "pipe.log");
    this.outputChannel.appendLine(`server cwd: ${paths().serverCwd.fsPath}`);
    this.outputChannel.appendLine(`analysis server path: ${analyzerPath}`);

    this.outputChannel.appendLine(`server args:`);
    const analyzerRpcServer = spawn(
      analyzerPath,
      [
        "-pipePath",
        pipeName,
        "-rules",
        analyzerLspRulesPaths,
        "-source-directory",
        location,
        "-log-file",
        logs,
      ],
      {
        cwd: paths().serverCwd.fsPath,
        env: serverEnv,
      },
    );

    analyzerRpcServer.stderr.on("data", (data) => {
      const asString: string = data.toString().trimEnd();
      this.outputChannel.appendLine(`${asString}`);
    });

    return [analyzerRpcServer, analyzerRpcServer.pid];
  }

  /**
   * Start the server process, wire the process's stderr to the output channel,
   * and wait (up to a maximum time) for the server to report itself ready.
   */
  protected async startProcessAndLogStderr(
    maxTimeToWaitUntilReady: number = 30_000,
  ): Promise<[ChildProcessWithoutNullStreams, number | undefined]> {
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

    const seenServerIsReady = false;
    kaiRpcServer.stderr.on("data", (data) => {
      // const asString: string = data.toString().trimEnd();
      // this.outputChannel.appendLine(`${asString}`);
      // if (!seenServerIsReady && asString.match(/kai-rpc-logger .*Started kai RPC Server/)) {
      //   seenServerIsReady = true;
      //   kaiRpcServer?.emit("serverReportsReady", pid);
      // }
    });

    const readyOrTimeout = await Promise.race([
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

    if (readyOrTimeout === "timeout") {
      // TODO: Handle the case where the server is not ready to initialize
      this.outputChannel.appendLine(
        `waited ${maxTimeToWaitUntilReady}ms for the kai rpc server to be ready, continuing anyway`,
      );
    } else if (readyOrTimeout === "ready") {
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
   */
  public async initialize(): Promise<void> {
    this.fireServerStateChange("initializing");

    // // Define the initialize request parameters
    // const initializeParams: KaiRpcApplicationConfig = {
    //   rootPath: paths().workspaceRepo.fsPath,
    //   modelProvider: this.modelProvider.modelProvider,
    //   logConfig: {
    //     logLevel: getConfigLogLevel(),
    //     fileLogLevel: getConfigLogLevel(),
    //     logDirPath: paths().serverLogs.fsPath,
    //   },
    //   demoMode: this.isDemoMode(),
    //   cacheDir: getCacheDir(),
    //   traceEnabled: getTraceEnabled(),
    //   // Paths to the Analyzer and jdt.ls
    //   analyzerLspRpcPath: this.getAnalyzerPath(),
    //   analyzerLspLspPath: this.assetPaths.jdtlsBin,
    //   analyzerLspRulesPaths: this.getRulesetsPath(),
    //   analyzerLspJavaBundlePaths: this.assetPaths.jdtlsBundleJars,
    //   analyzerLspDepLabelsPath: this.assetPaths.openSourceLabelsFile,
    //   analyzerLspLabelSelector: getConfigLabelSelector(),
    //   analyzerLspExcludedPaths: ignoresToExcludedPaths(),

    // TODO: Do we need to include `fernFlowerPath` to support the java decompiler?
    // analyzerLspFernFlowerPath: this.assetPaths.fernFlowerPath,

    // TODO: Once konveyor/kai#550 is resolved, analyzer configurations can be supported
    // analyzerIncidentLimit: getConfigIncidentLimit(),
    // analyzerContextLines: getConfigContextLines(),
    // analyzerCodeSnipLimit: getConfigCodeSnipLimit(),
    // analyzerAnalyzeKnownLibraries: getConfigAnalyzeKnownLibraries(),
    // analyzerAnalyzeDependencies: getConfigAnalyzeDependencies(),
    // };

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Initializing Kai",
        cancellable: false,
      },
      async (progress) => {
        // this.outputChannel.appendLine(
        //   // `Sending 'initialize' request: ${JSON.stringify(initializeParams)}`,
        // );
        progress.report({
          message: "Sending 'initialize' request to RPC Server",
        });

        const exitWatcher = new Promise<void>((_, reject) => {
          this.analyzerRpcServer!.once("exit", (code, signal) => {
            reject(
              new Error(`kai-analyzer-server exited unexpectedly (code=${code}, signal=${signal})`),
            );
          });
        });

        try {
          // Race the RPC call vs. the “server exited” watcher
          // const response = await Promise.race([
          //   this.rpcConnection!.sendRequest<void>("initialize", initializeParams),
          //   exitWatcher,
          // ]);

          // this.outputChannel.appendLine(`'initialize' response: ${JSON.stringify(response)}`);
          this.outputChannel.appendLine(`kai analyzer rpc server is initialized!`);
          this.fireServerStateChange("running");
          progress.report({ message: "Kai RPC Server is initialized." });
        } catch (err) {
          // The race either saw a process exit or an RPC-level failure
          this.outputChannel.appendLine(
            `kai analyzer rpc server failed to initialize [err: ${err}]`,
          );
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
    if (this.serverState !== "running" || !this.analyzerRpcConnection) {
      this.outputChannel.appendLine("kai rpc server is not running, skipping runAnalysis.");
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
          const activeProfile = this.getExtStateData().profiles.find(
            (p) => p.id === this.getExtStateData().activeProfileId,
          );
          if (!activeProfile) {
            this.outputChannel.appendLine("No active profile found.");
            vscode.window.showErrorMessage("No active profile found.");
            this.fireAnalysisStateChange(false);
            return;
          }
          if (!activeProfile.labelSelector) {
            this.outputChannel.appendLine("LabelSelector is not configured.");
            vscode.window.showErrorMessage("LabelSelector is not configured.");
            this.fireAnalysisStateChange(false);
            return;
          }

          const requestParams = {
            label_selector: activeProfile.labelSelector,
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
            this.analyzerRpcConnection!.sendRequest("analysis_engine.Analyze", requestParams).then(
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
    const { activeProfileId, profiles } = this.getExtStateData();
    const profile = profiles.find((p) => p.id === activeProfileId);
    return (
      !!profile?.labelSelector && (profile?.useDefaultRules || profile?.customRules.length > 0)
    );
  }

  public async canAnalyzeInteractive(): Promise<boolean> {
    let config;
    try {
      config = this.getActiveProfileConfig();
    } catch (err) {
      vscode.window.showErrorMessage("No active analysis profile is configured.");
      return false;
    }

    if (!config.labelSelector) {
      const selection = await vscode.window.showErrorMessage(
        "Label selector is missing from the active profile. Please configure it before starting the analyzer.",
        "Manage Profiles",
        "Cancel",
      );

      if (selection === "Manage Profiles") {
        await vscode.commands.executeCommand("konveyor.openProfileManager");
      }

      return false;
    }

    if (config.rulesets.length === 0) {
      const selection = await vscode.window.showWarningMessage(
        "No rules are defined in the active profile. Enable default rules or provide custom rules.",
        "Manage Profiles",
        "Cancel",
      );

      if (selection === "Manage Profiles") {
        await vscode.commands.executeCommand("konveyor.openProfileManager");
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

  protected getKaiRpcServerPath(): string {
    const path = getConfigKaiRpcServerPath() || this.assetPaths.kaiRpcServer;

    if (!fs.existsSync(path)) {
      const message = `RPC Server binary doesn't exist at ${path}`;
      this.outputChannel.appendLine(`Error: ${message}`);
      vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    return path;
  }

  protected getKaiRpcServerArgs(): string[] {
    return [
      "--log-level",
      getConfigLogLevel(),
      "--file-log-level",
      getConfigLogLevel(),
      "--log-dir-path",
      paths().serverLogs.fsPath,
    ].filter(Boolean);
  }

  protected getRulesetsPath(): string[] {
    return this.getActiveProfileConfig().rulesets;
  }

  protected getActiveProfileConfig() {
    const { activeProfileId, profiles } = this.getExtStateData();
    const profile = profiles.find((p) => p.id === activeProfileId);
    if (!profile) {
      throw new Error("No active profile configured.");
    }

    const rulesets: string[] = [
      profile.useDefaultRules ? this.assetPaths.rulesets : null,
      ...(profile.customRules || []),
    ].filter(Boolean) as string[];

    return {
      labelSelector: profile.labelSelector,
      rulesets,
      isValid: !!profile.labelSelector && rulesets.length > 0,
    };
  }
}
