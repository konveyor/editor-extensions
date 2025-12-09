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
import { ProgressEvent, VALID_PROGRESS_STAGES } from "./progressParser";
import { countIncidentsOnPaths } from "../analysis";
import { Socket } from "node:net";
import { FileChange } from "./types";
import { TaskManager } from "src/taskManager/types";
import { Logger } from "winston";
import { executeExtensionCommand } from "../commands";
import { ProviderRegistry } from "../api";

export class AnalyzerClient {
  // Progress percentage ranges for each stage
  private static readonly PROGRESS_PROVIDER_INIT = 10;
  private static readonly PROGRESS_PROVIDER_PREPARE_START = 10;
  private static readonly PROGRESS_PROVIDER_PREPARE_END = 15;
  private static readonly PROGRESS_RULE_PARSING = 20;
  private static readonly PROGRESS_RULE_EXECUTION_START = 20;
  private static readonly PROGRESS_RULE_EXECUTION_END = 90;

  private assetPaths: AssetPaths;
  private analyzerRpcServer: ChildProcessWithoutNullStreams | null = null;
  private analyzerRpcConnection?: rpc.MessageConnection | null;
  private currentProgressCallback?: (event: ProgressEvent) => void;

  constructor(
    private extContext: vscode.ExtensionContext,
    private mutateServerState: (recipe: (draft: ExtensionData) => void) => void,
    private mutateAnalysisState: (recipe: (draft: ExtensionData) => void) => void,
    private getExtStateData: () => Immutable<ExtensionData>,
    private readonly taskManager: TaskManager,
    private readonly logger: Logger,
    private readonly providerRegistry: ProviderRegistry,
  ) {
    this.assetPaths = buildAssetPaths(extContext);
    this.taskManager = taskManager;
    this.logger = logger.child({
      component: "AnalyzerClient",
    });
    // TODO: Push the serverState from "initial" to either "configurationNeeded" or "configurationReady"
  }

  private fireServerStateChange(state: ServerState) {
    this.mutateServerState((draft) => {
      this.logger.info(`serverState change from [${draft.serverState}] to [${state}]`);
      draft.serverState = state;
      draft.isStartingServer = state === "starting";
      draft.isInitializingServer = state === "initializing";
    });
  }

  private fireAnalysisStateChange(flag: boolean) {
    this.mutateAnalysisState((draft) => {
      draft.isAnalyzing = flag;
      // Reset progress when analysis completes
      if (!flag) {
        draft.analysisProgress = 0;
        draft.analysisProgressMessage = "";
      }
    });
  }

  private isProgressEvent(obj: any): obj is ProgressEvent {
    return (
      typeof obj === "object" &&
      obj !== null &&
      typeof obj.timestamp === "string" &&
      typeof obj.stage === "string" &&
      VALID_PROGRESS_STAGES.includes(obj.stage as any)
    );
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

    // Log registered providers
    const providers = this.providerRegistry.getProviders();
    this.logger.info(`Found ${providers.length} registered language provider(s)`, {
      providers: providers.map((p) => ({
        name: p.name,
        providerConfig: p.providerConfig,
      })),
    });

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
    this.analyzerRpcConnection.onNotification("analysis.progress", (params: unknown) => {
      this.logger.debug(`Received analysis.progress notification: ${JSON.stringify(params)}`);
      if (this.currentProgressCallback && this.isProgressEvent(params)) {
        this.currentProgressCallback(params);
      }
    });
    this.analyzerRpcConnection.onNotification((method: string, params: any) => {
      this.logger.debug(`Received notification: ${method} + ${JSON.stringify(params)}`);
    });
    this.analyzerRpcConnection.onUnhandledNotification((e) => {
      this.logger.warn(`Unhandled notification: ${e.method}`);
    });
    this.analyzerRpcConnection.onError((e) => {
      this.logger.error("RPC connection error", e);
    });
    this.analyzerRpcConnection.listen();
    this.analyzerRpcConnection.sendNotification("start", { type: "start" });
    this.logger.info(`startAnalyzer took ${performance.now() - startTime}ms`);
  }

  protected async getSocket(pipeName: string): Promise<Socket> {
    const MAX_RETRIES = 150; // retry for 5 minutes to connect to the analyzer pipe
    const RETRY_DELAY = 2000;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const s = new Socket();
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: Error) => reject(err);
          s.once("connect", () => {
            s.off("error", onError);
            resolve();
          });
          s.once("error", onError);
          s.connect(pipeName);
        });
        return s;
      } catch (err) {
        s.destroy();
        if (attempt === MAX_RETRIES) {
          this.logger.error("Error connecting to analyzer pipe after maximum retries", {
            attempt,
            err,
          });
          break;
        }
        await setTimeout(RETRY_DELAY);
      }
    }
    throw new Error(
      "Unable to connect to analyzer pipe after multiple retries. The analyzer may not have created the pipe yet or the environment is misconfigured.",
    );
  }

  protected startAnalysisServer(
    pipeName: string,
  ): [ChildProcessWithoutNullStreams, number | undefined] {
    const analyzerPath = this.getAnalyzerPath();
    const serverEnv = this.getKaiRpcServerEnv();
    const analyzerLspRulesPaths = this.getRulesetsPath().join(",");
    const logs = path.join(paths().serverLogs.fsPath, "analyzer.log");
    this.logger.info(`server cwd: ${paths().serverCwd.fsPath}`);
    this.logger.info(`analysis server path: ${analyzerPath}`);

    // Collect provider configs from registered providers
    const providers = this.providerRegistry.getProviders();
    const providerConfigs = providers.map((p) => p.providerConfig);

    this.logger.info(`Starting analyzer with ${providerConfigs.length} provider config(s)`, {
      providerConfigs,
    });

    // Write provider configs to temp JSON file
    const providerConfigPath = path.join(paths().serverLogs.fsPath, "provider-config.json");
    try {
      fs.writeFileSync(providerConfigPath, JSON.stringify(providerConfigs, null, 2), "utf-8");
      this.logger.info(`Wrote provider config to ${providerConfigPath}`);
    } catch (err) {
      this.logger.error("Failed to write provider config", err);
      throw new Error(
        `Failed to write provider config: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const args = [
      "-server-pipe",
      pipeName,
      "-rules",
      analyzerLspRulesPaths,
      "-log-file",
      logs,
      "-verbosity",
      "-4",
      "-progress-output",
      "stderr",
      "-progress-format",
      "json",
    ];

    // Add provider-config if we have providers
    if (providerConfigs.length > 0) {
      args.push("-provider-config", providerConfigPath);
    }

    this.logger.info(`Starting kai-analyzer-rpc with args: ${args.join(" ")}`);

    const analyzerRpcServer = spawn(analyzerPath, args, {
      cwd: paths().serverCwd.fsPath,
      env: serverEnv,
    });

    // Progress updates are now received via RPC notifications (analysis.progress)
    // The stderr-based progress parsing has been removed to avoid duplicate progress updates
    analyzerRpcServer.stderr.on("data", (data) => {
      // Log stderr output for debugging
      this.logger.debug(`Analyzer stderr: ${data.toString()}`);
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

  public getRegisteredProviders() {
    return this.providerRegistry.getProviders();
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
          progress.report({ message: "Initializing..." });
          this.fireAnalysisStateChange(true);

          // Set up progress callback to update VS Code UI and webview
          // The callback handles progress events and updates two separate UIs:
          // - notificationMessage: Abbreviated message for VS Code notification (lower right)
          // - webviewMessage: Detailed message for the Analysis View webview
          this.currentProgressCallback = (event: ProgressEvent) => {
            let notificationMessage = "";
            let webviewMessage = "";
            let progressPercent = 0;

            switch (event.stage) {
              case "init":
                notificationMessage = "Initializing analysis...";
                webviewMessage = notificationMessage;
                progressPercent = 0;
                break;
              case "provider_init":
                notificationMessage = event.message
                  ? `Provider: ${event.message}`
                  : "Initializing providers...";
                webviewMessage = notificationMessage;
                progressPercent = AnalyzerClient.PROGRESS_PROVIDER_INIT;
                break;
              case "provider_prepare":
                if (event.total && event.current) {
                  const filePercent = Math.min(
                    100,
                    Math.max(0, event.percent || (event.current / event.total) * 100),
                  );
                  // Map file processing progress from provider_prepare start to end
                  const prepareRange =
                    AnalyzerClient.PROGRESS_PROVIDER_PREPARE_END -
                    AnalyzerClient.PROGRESS_PROVIDER_PREPARE_START;
                  progressPercent =
                    AnalyzerClient.PROGRESS_PROVIDER_PREPARE_START +
                    (filePercent * prepareRange) / 100;

                  // Abbreviated message for notification
                  notificationMessage = `Processing file ${event.current}/${event.total}`;

                  // Detailed message for webview
                  webviewMessage = event.message
                    ? `Processing file ${event.current}/${event.total}: ${event.message}`
                    : notificationMessage;
                } else {
                  notificationMessage = "Processing files...";
                  webviewMessage = notificationMessage;
                  progressPercent = AnalyzerClient.PROGRESS_PROVIDER_PREPARE_START;
                }
                break;
              case "rule_parsing":
                notificationMessage = event.total
                  ? `Loaded ${event.total} rules`
                  : "Loading rules...";
                webviewMessage = notificationMessage;
                progressPercent = AnalyzerClient.PROGRESS_RULE_PARSING;
                break;
              case "rule_execution":
                if (event.total && event.current) {
                  const rulePercent = Math.min(
                    100,
                    Math.max(0, event.percent || (event.current / event.total) * 100),
                  );
                  // Map rule execution progress from start to end
                  const executionRange =
                    AnalyzerClient.PROGRESS_RULE_EXECUTION_END -
                    AnalyzerClient.PROGRESS_RULE_EXECUTION_START;
                  progressPercent =
                    AnalyzerClient.PROGRESS_RULE_EXECUTION_START +
                    (rulePercent * executionRange) / 100;

                  // Abbreviated message for notification
                  notificationMessage = `Processing rule ${event.current}/${event.total}`;

                  // Detailed message with rule ID for webview
                  // Note: event.message contains different data depending on stage:
                  // - provider_init: provider name
                  // - rule_execution: rule ID (when available)
                  const ruleId = event.message || event.metadata?.rule_id || event.metadata?.ruleId;
                  if (ruleId) {
                    webviewMessage = `Processing rule ${event.current}/${event.total}: ${ruleId}`;
                  } else {
                    webviewMessage = notificationMessage;
                  }
                } else {
                  notificationMessage = "Processing rules...";
                  webviewMessage = notificationMessage;
                  progressPercent = 20;
                }
                break;
              case "dependency_analysis":
                notificationMessage = "Analyzing dependencies...";
                webviewMessage = notificationMessage;
                progressPercent = 90;
                break;
              case "complete":
                notificationMessage = "Analysis complete!";
                webviewMessage = notificationMessage;
                progressPercent = 100;
                break;
              default:
                notificationMessage = `Analysis in progress (${event.stage})...`;
                webviewMessage = notificationMessage;
                progressPercent = 50;
            }

            // Update VS Code progress notification with abbreviated message
            progress.report({ message: notificationMessage });

            // Update extension state for webview with detailed message
            this.mutateAnalysisState((draft) => {
              draft.analysisProgress = Math.min(100, Math.max(0, Math.round(progressPercent)));
              draft.analysisProgressMessage = webviewMessage;
            });
          };
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

          // Emit analysis complete event to registered providers
          this.providerRegistry.emitAnalysisComplete({
            success: true,
            incidentCount: summary.incidentCount,
          });
        } catch (err: any) {
          this.logger.error("Error during analysis", err);
          vscode.window.showErrorMessage("Analysis failed. See the output channel for details.");

          // Emit analysis failure event to registered providers
          this.providerRegistry.emitAnalysisComplete({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          // Clear progress callback
          this.currentProgressCallback = undefined;
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
