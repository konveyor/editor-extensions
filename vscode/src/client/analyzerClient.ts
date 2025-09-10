import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import path from "node:path";
import * as fs from "fs-extra";
import * as vscode from "vscode";
import * as rpc from "vscode-jsonrpc/node";
import {
  ExtensionData,
  RuleSet,
  ServerState,
  SolutionState,
  Violation,
} from "@editor-extensions/shared";
import { paths, ignoresToExcludedPaths } from "../paths";
import { normalizeFilePath } from "../utilities/pathUtils";
import { Extension } from "../helpers/Extension";
import { buildAssetPaths, AssetPaths } from "./paths";
import { getConfigAnalyzerPath, getConfigKaiDemoMode, isAnalysisResponse } from "../utilities";
import { allIncidents } from "../issueView";
import { Immutable } from "immer";
import { countIncidentsOnPaths } from "../analysis";
import { createConnection, Socket } from "node:net";
import { FileChange } from "./types";
import { TaskManager } from "src/taskManager/types";
import { Logger } from "winston";
import { executeExtensionCommand } from "../commands";

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
  private analyzerRpcServer: ChildProcessWithoutNullStreams | null = null;
  private analyzerRpcConnection?: rpc.MessageConnection | null;

  constructor(
    private extContext: vscode.ExtensionContext,
    private mutateExtensionData: (recipe: (draft: ExtensionData) => void) => void,
    private getExtStateData: () => Immutable<ExtensionData>,
    private readonly taskManager: TaskManager,
    private readonly logger: Logger,
  ) {
    this.assetPaths = buildAssetPaths(extContext);
    this.taskManager = taskManager;
    this.logger = logger.child({
      component: "AnalyzerClient",
    });
    // TODO: Push the serverState from "initial" to either "configurationNeeded" or "configurationReady"
  }

  private fireServerStateChange(state: ServerState) {
    this.mutateExtensionData((draft) => {
      this.logger.info(`serverState change from [${draft.serverState}] to [${state}]`);
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

    this.logger.info("Starting kai analyzer rpc");
    this.fireServerStateChange("starting");
    const startTime = performance.now();

    const pipeName = rpc.generateRandomPipeName();
    const [analyzerRpcServer, analyzerPid] = this.startAnalysisServer(pipeName);
    analyzerRpcServer.on("exit", (code, signal) => {
      this.logger.info(`Analyzer RPC server terminated [signal: ${signal}, code: ${code}]`);
      if (code) {
        vscode.window.showErrorMessage(
          `Analyzer RPC server failed. Status code: ${code}. Please see the output channel for details.`,
        );
      }
      this.fireServerStateChange("stopped");
      this.analyzerRpcServer = null;
    });
    analyzerRpcServer.on("close", (code, signal) => {
      this.logger.info(`Analyzer RPC server closed [signal: ${signal}, code: ${code}]`);
      this.fireServerStateChange("stopped");
      this.analyzerRpcServer = null;
    });
    analyzerRpcServer.on("error", (err) => {
      this.logger.error("Analyzer RPC server error", err);
      this.fireServerStateChange("startFailed");
      this.analyzerRpcServer = null;
      vscode.window.showErrorMessage(
        `Analyzer RPC server failed - ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.analyzerRpcServer = analyzerRpcServer;
    this.logger.info(`Analyzer RPC server started successfully [pid: ${analyzerPid}]`);

    const socket: Socket = await this.getSocket(pipeName);
    socket.addListener("connectionAttempt", () => {
      this.logger.info("Attempting to establish connection...");
    });
    socket.addListener("connectionAttemptFailed", () => {
      this.logger.info("Connection attempt failed");
    });
    socket.on("data", (data) => {
      this.logger.debug(`Received data: ${data.toString()}`);
    });
    const reader = new rpc.SocketMessageReader(socket, "utf-8");
    const writer = new rpc.SocketMessageWriter(socket, "utf-8");

    reader.onClose(() => {
      this.logger.info("Message reader closed");
    });
    reader.onError((e) => {
      this.logger.error("Error in message reader", e);
    });
    writer.onClose(() => {
      this.logger.info("Message writer closed");
    });
    writer.onError((e) => {
      this.logger.error("Error in message writer", e);
    });
    this.analyzerRpcConnection = rpc.createMessageConnection(reader, writer);
    this.analyzerRpcConnection.trace(
      rpc.Trace.Messages,
      {
        log: (message) => {
          this.logger.silly("RPC Trace", { message: JSON.stringify(message) });
        },
      },
      false,
    );
    this.analyzerRpcConnection.onUnhandledNotification((e) => {
      this.logger.warn(`Unhandled notification: ${e.method}`);
    });

    this.analyzerRpcConnection.onClose(() => this.logger.info("RPC connection closed"));
    this.analyzerRpcConnection.onRequest((method, params) => {
      this.logger.debug(`Received request: ${method} + ${JSON.stringify(params)}`);
    });

    this.analyzerRpcConnection.onNotification("started", (_: []) => {
      this.logger.info("Server initialization complete");
      this.fireServerStateChange("running");
    });
    this.analyzerRpcConnection.onNotification((method: string, params: any) => {
      this.logger.debug(`Received notification: ${method} + ${JSON.stringify(params)}`);
    });
    this.analyzerRpcConnection.onUnhandledNotification((e) => {
      this.logger.warn(`Unhandled notification: ${e.method}`);
    });
    this.analyzerRpcConnection.onRequest(
      "workspace/executeCommand",
      async (params: WorksapceCommandParams) => {
        this.logger.debug(`Executing workspace command`, {
          command: params.command,
          arguments: JSON.stringify(params.arguments),
        });

        try {
          const result = await vscode.commands.executeCommand(
            "java.execute.workspaceCommand",
            params.command,
            params.arguments![0],
          );

          this.logger.debug(`Command execution result: ${JSON.stringify(result)}`);
          return result;
        } catch (error) {
          this.logger.error(`[Java] Command execution error`, error);
        }
      },
    );
    this.analyzerRpcConnection.onError((e) => {
      this.logger.error("RPC connection error", e);
    });
    this.analyzerRpcConnection.listen();
    this.analyzerRpcConnection.sendNotification("start", { type: "start" });
    await this.runHealthCheck();
    this.logger.info(`startAnalyzer took ${performance.now() - startTime}ms`);
  }

  protected async runHealthCheck(): Promise<void> {
    if (!this.analyzerRpcConnection) {
      this.logger.warn("Analyzer RPC connection is not established");
      return;
    }
    try {
      const healthcheckResult = await vscode.commands.executeCommand(
        "java.execute.workspaceCommand",
        "java.project.getAll",
      );
      this.logger.info(
        `Java Language Server Healthcheck result: ${JSON.stringify(healthcheckResult)}`,
      );
      if (
        healthcheckResult === undefined ||
        !Array.isArray(healthcheckResult) ||
        healthcheckResult.length < 1
      ) {
        vscode.window.showErrorMessage(
          "It appears that the Java Language Server is not running or the project configuration is not set up correctly. Analysis results may be degraded.",
        );
      }
    } catch (error) {
      this.logger.error("Error running Java Language Server healthcheck", error);
    }
  }

  protected async getSocket(pipeName: string): Promise<Socket> {
    const s = createConnection(pipeName);
    let ready = false;
    const MAX_RETRIES = 5;
    const RETRY_DELAY = 2000; // 2 seconds
    let retryCount = 0;

    s.on("ready", () => {
      this.logger.info("got ready message");
      ready = true;
    });

    while ((s.connecting || !s.readable) && !ready && retryCount < MAX_RETRIES) {
      await setTimeout(RETRY_DELAY);
      retryCount++;

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
      throw Error(
        "Unable to connect after multiple retries. Please check Java environment configuration.",
      );
    }
  }

  protected startAnalysisServer(
    pipeName: string,
  ): [ChildProcessWithoutNullStreams, number | undefined] {
    const analyzerPath = this.getAnalyzerPath();
    const serverEnv = this.getKaiRpcServerEnv();
    const analyzerLspRulesPaths = this.getRulesetsPath().join(",");
    const location = paths().workspaceRepo.fsPath;
    const logs = path.join(paths().serverLogs.fsPath, "analyzer.log");
    this.logger.info(`server cwd: ${paths().serverCwd.fsPath}`);
    this.logger.info(`analysis server path: ${analyzerPath}`);

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
      this.logger.error(`${asString}`);
    });

    return [analyzerRpcServer, analyzerRpcServer.pid];
  }

  protected isDemoMode(): boolean {
    const configDemoMode = getConfigKaiDemoMode();

    return configDemoMode !== undefined
      ? configDemoMode
      : !Extension.getInstance(this.extContext).isProductionMode;
  }

  /**
   * Shutdown and, if necessary, hard stops the server.
   *
   * Will run from any server state, and any running server process will be killed.
   *
   * Server state change: `stopping`
   */
  public async stop(): Promise<void> {
    this.logger.info(`Stopping the analyzer rpc server...`);
    this.fireServerStateChange("stopping");

    // First close the RPC connection if it exists
    if (this.analyzerRpcConnection) {
      this.logger.info(`Closing analyzer rpc connection...`);
      this.analyzerRpcConnection.end();
      this.analyzerRpcConnection.dispose();
      this.analyzerRpcConnection = null;
    }

    // Then stop the server process if it exists
    if (this.analyzerRpcServer) {
      if (this.analyzerRpcServer.exitCode === null) {
        this.analyzerRpcServer.kill();
      }
      this.analyzerRpcServer = null;
    }

    this.logger.info(`analyzer rpc server stopped`);
  }

  public isServerRunning(): boolean {
    return !!this.analyzerRpcServer && !this.analyzerRpcServer.killed;
  }

  public async notifyFileChanges(fileChanges: FileChange[]): Promise<void> {
    if (this.serverState !== "running" || !this.analyzerRpcConnection) {
      this.logger.warn("kai rpc server is not running, skipping notifyFileChanged.");
      return;
    }
    const changes = fileChanges.map((change) => ({
      path: change.path.fsPath,
      content: change.content,
      saved: change.saved,
    }));
    if (changes.length > 0) {
      await this.analyzerRpcConnection!.sendRequest("analysis_engine.NotifyFileChanges", {
        changes: changes,
      });
    }
  }

  /**
   * Request the server to __Analyze__
   *
   * Will only run if the sever state is: `running`
   */
  public async runAnalysis(filePaths?: vscode.Uri[]): Promise<void> {
    if (this.serverState !== "running" || !this.analyzerRpcConnection) {
      this.logger.warn("kai rpc server is not running, skipping runAnalysis.");
      return;
    }
    this.logger.info("Running analysis");
    const analysisStartTime = performance.now();

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
            this.logger.warn("No active profile found.");
            vscode.window.showErrorMessage("No active profile found.");
            this.fireAnalysisStateChange(false);
            return;
          }
          if (!activeProfile.labelSelector) {
            this.logger.warn("LabelSelector is not configured.");
            vscode.window.showErrorMessage("LabelSelector is not configured.");
            this.fireAnalysisStateChange(false);
            return;
          }

          const requestParams = {
            label_selector: activeProfile.labelSelector,
            included_paths: filePaths?.map((uri) => normalizeFilePath(uri.fsPath)),
            reset_cache: !(filePaths && filePaths.length > 0),
            excluded_paths: ignoresToExcludedPaths().flatMap((path) => [
              path,
              normalizeFilePath(path),
            ]),
          };
          this.logger.info(
            `Sending 'analysis_engine.Analyze' request with params: ${JSON.stringify(
              requestParams,
            )}`,
          );

          if (token.isCancellationRequested) {
            this.logger.warn("Analysis was canceled by the user.");
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
            this.logger.warn("Analysis operation was canceled.");
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

          this.logger.info(`Response received. Summary: ${JSON.stringify(summary)}`);

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

          // Add active profile name to each RuleSet
          const currentProfile = this.getExtStateData().profiles.find(
            (p) => p.id === this.getExtStateData().activeProfileId,
          );
          if (currentProfile) {
            ruleSets.forEach((ruleSet) => {
              (ruleSet as any).activeProfileName = currentProfile.name;
            });
          }

          await executeExtensionCommand("loadRuleSets", ruleSets);
          this.taskManager.init();
          progress.report({ message: "Results processed!" });
          vscode.window.showInformationMessage("Analysis completed successfully!");
        } catch (err: any) {
          this.logger.error("Error during analysis", err);
          vscode.window.showErrorMessage("Analysis failed. See the output channel for details.");
        }
        this.fireAnalysisStateChange(false);
      },
    );
    this.logger.info(`runAnalysis took ${performance.now() - analysisStartTime}ms`);
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
    } catch {
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
        await executeExtensionCommand("openProfilesPanel");
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
        await executeExtensionCommand("openProfilesPanel");
      }

      return false;
    }

    return true;
  }

  protected getAnalyzerPath(): string {
    const path = getConfigAnalyzerPath() || this.assetPaths.kaiAnalyzer;

    if (!fs.existsSync(path)) {
      const message = `Analyzer binary doesn't exist at ${path}`;
      this.logger.error(message);
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
    };
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
