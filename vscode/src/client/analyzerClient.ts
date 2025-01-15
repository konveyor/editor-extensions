import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as path from "node:path";
import { setTimeout } from "node:timers/promises";
import * as fs from "fs-extra";
import * as vscode from "vscode";
import * as rpc from "vscode-jsonrpc/node";
import { Incident, RuleSet, SolutionResponse, Violation } from "@editor-extensions/shared";
import { ExtensionData, ServerState } from "@editor-extensions/shared";
import { buildDataFolderPath } from "../data";
import { Extension } from "../helpers/Extension";
import { ExtensionState } from "../extensionState";
import { buildAssetPaths, AssetPaths } from "./paths";
import {
  getConfigKaiBackendURL,
  getConfigLogLevel,
  getConfigKaiProviderName,
  getConfigKaiProviderArgs,
  getConfigLabelSelector,
  updateUseDefaultRuleSets,
  getConfigKaiRpcServerPath,
  getConfigAnalyzerPath,
  getGenAiKey,
  getConfigMaxDepth,
  getConfigMaxIterations,
  getConfigMaxPriority,
  getConfigKaiDemoMode,
  isAnalysisResponse,
} from "../utilities";
import { allIncidents } from "../issueView";
import { Immutable } from "immer";
import { countIncidentsOnPaths } from "../analysis";

export class AnalyzerClient {
  private kaiRpcServer: ChildProcessWithoutNullStreams | null = null;
  private rpcConnection: rpc.MessageConnection | null = null;

  private outputChannel: vscode.OutputChannel;
  private assetPaths: AssetPaths;
  private kaiDir: string;
  private kaiRuntimeDir: string;
  private kaiConfigToml: string;
  private fireStateChange: (state: ServerState) => void;
  private fireAnalysisStateChange: (flag: boolean) => void;
  private fireSolutionStateChange: (flag: boolean) => void;

  constructor(
    private extContext: vscode.ExtensionContext,
    mutateExtensionData: (recipe: (draft: ExtensionData) => void) => void,
    private getExtStateData: () => Immutable<ExtensionData>,
  ) {
    this.fireStateChange = (state: ServerState) =>
      mutateExtensionData((draft) => {
        draft.serverState = state;
        draft.isStartingServer = state === "starting";
      });
    this.fireAnalysisStateChange = (flag: boolean) =>
      mutateExtensionData((draft) => {
        draft.isAnalyzing = flag;
      });
    this.fireSolutionStateChange = (flag: boolean) =>
      mutateExtensionData((draft) => {
        draft.isFetchingSolution = flag;
      });

    this.outputChannel = vscode.window.createOutputChannel("Konveyor-Analyzer");
    this.assetPaths = buildAssetPaths(extContext);

    // TODO: Move the directory and file creation to extension init...
    this.kaiDir = path.join(buildDataFolderPath()!, "kai");
    this.kaiRuntimeDir = path.join(buildDataFolderPath()!, "kai-runtime");
    this.kaiConfigToml = path.join(this.kaiDir, "kai-config.toml");

    fs.ensureDirSync(this.kaiDir);
    fs.ensureDirSync(this.kaiRuntimeDir);
    // TODO: ...end

    // TODO: Push the serverState from "initial" to either "configurationNeeded" or "configurationReady"

    this.outputChannel.appendLine(
      `current asset paths: ${JSON.stringify(this.assetPaths, null, 2)}`,
    );
    this.outputChannel.appendLine(`Kai directory: ${this.kaiDir}`);
    this.outputChannel.appendLine(`Kai config toml: ${this.kaiConfigToml}`);
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
    this.fireStateChange("starting");
    try {
      const [kaiRpcServer, pid] = await this.startProcessAndLogStderr();

      kaiRpcServer.on("exit", (code, signal) => {
        this.outputChannel.appendLine(`kai rpc server exited [signal: ${signal}, code: ${code}]`);
        this.fireStateChange("stopped");
      });

      this.kaiRpcServer = kaiRpcServer;
      this.outputChannel.appendLine(`kai rpc server successfully started [pid: ${pid}]`);
      this.fireStateChange("readyToInitialize");
    } catch (e) {
      this.outputChannel.appendLine(`kai rpc server start failed [error: ${e}]`);
      this.fireStateChange("startFailed");
      throw e;
    }

    // Set up the JSON-RPC connection
    this.rpcConnection = rpc.createMessageConnection(
      new rpc.StreamMessageReader(this.kaiRpcServer.stdout),
      new rpc.StreamMessageWriter(this.kaiRpcServer.stdin),
    );
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

    const serverCwd = vscode.Uri.joinPath(this.extContext.storageUri!, "kai-rpc-server");
    const serverPath = this.getKaiRpcServerPath();
    const serverArgs = this.getKaiRpcServerArgs();
    const serverEnv = await this.getKaiRpcServerEnv();

    if (!fs.existsSync(serverCwd.fsPath)) {
      await vscode.workspace.fs.createDirectory(serverCwd);
    }

    this.outputChannel.appendLine(`server cwd: ${serverCwd}`);
    this.outputChannel.appendLine(`server path: ${serverPath}`);
    this.outputChannel.appendLine(`server args:`);
    serverArgs.forEach((arg) => this.outputChannel.appendLine(`   ${arg}`));

    const kaiRpcServer = spawn(serverPath, serverArgs, {
      cwd: this.extContext.storageUri?.fsPath,
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

  protected buildModelProviderConfig() {
    const config = vscode.workspace.getConfiguration("konveyor.kai");
    const userProviderArgs = getConfigKaiProviderArgs();
    const providerArgs = userProviderArgs || config.get<object>("providerArgs");

    const modelProviderSection = {
      provider: getConfigKaiProviderName(),
      args: providerArgs,
    };
    return modelProviderSection;
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

    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      return;
    }

    // Define the initialize request parameters
    // TODO: With konveyor/kai#526, config.toml will be dropped.  The initialize parameters may
    // TODO: change.  They'll need to be updated here.
    const initializeParams = {
      process_id: null,
      kai_backend_url: getConfigKaiBackendURL(),
      root_path: vscode.workspace.workspaceFolders![0].uri.fsPath,
      log_level: getConfigLogLevel(),
      log_dir_path: this.kaiDir,
      model_provider: this.buildModelProviderConfig(),

      file_log_level: getConfigLogLevel(),
      demo_mode: this.isDemoMode(),
      cache_dir: "",

      // Analyzer and jdt.ls parameters
      analyzer_lsp_rpc_path: this.getAnalyzerPath(),
      analyzer_lsp_lsp_path: this.assetPaths.jdtlsBin,

      // jdt.ls bundles (comma separated list of paths)
      analyzer_lsp_java_bundle_path: this.assetPaths.jdtlsBundleJars.join(","),

      // depOpenSourceLabelsFile
      analyzer_lsp_dep_labels_path: this.assetPaths.openSourceLabelsFile,

      // TODO: Do we need to include `fernFlowerPath` to support the java decompiler?
      // analyzer_lsp_fernflower: this.assetPaths.fernFlowerPath,

      analyzer_lsp_rules_path: this.getRulesetsPath(),
    };

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Initializing Kai",
        cancellable: false,
      },
      async (progress) => {
        this.outputChannel.appendLine("Sending 'initialize' request.");
        progress.report({
          message: "Sending 'initialize' request to RPC Server",
        });

        try {
          this.outputChannel.appendLine(
            `initialize payload: ${JSON.stringify(initializeParams, null, 2)}`,
          );

          const response = await this.rpcConnection!.sendRequest<void>(
            "initialize",
            initializeParams,
          );

          this.outputChannel.appendLine(
            `'initialize' response: ${JSON.stringify(response, null, 2)}`,
          );
          this.outputChannel.appendLine(`kai rpc server is initialized!`);
          progress.report({ message: "RPC Server initialized" });
          this.fireStateChange("running");
        } catch (err) {
          this.outputChannel.appendLine(`kai rpc server failed to initialize [err: ${err}]`);
          progress.report({ message: "Kai initialization failed!" });
          this.fireStateChange("startFailed");
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
    this.fireStateChange("stopping");
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
                  .flatMap((r) => Object.values(r.violations ?? {}))
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
            vscode.window.showInformationMessage("Analysis completed, but no RuleSets were found.");
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
  public async getSolution(
    state: ExtensionState,
    incidents: Incident[],
    violation: Violation,
  ): Promise<void> {
    // TODO: Ensure serverState is running

    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      return;
    }

    this.fireSolutionStateChange(true);

    const enhancedIncidents = incidents.map((incident) => ({
      ...incident,
      ruleset_name: violation.category || "default_ruleset",
      violation_name: violation.description || "default_violation",
    }));

    const maxPriority = getConfigMaxPriority();
    const maxDepth = getConfigMaxDepth();
    const maxIterations = getConfigMaxIterations();

    try {
      const request = {
        file_path: "",
        incidents: enhancedIncidents,
        max_priority: maxPriority,
        max_depth: maxDepth,
        max_iterations: maxIterations,
      };

      this.outputChannel.appendLine(
        `getCodeplanAgentSolution request: ${JSON.stringify(request, null, 2)}`,
      );

      const response: SolutionResponse = await this.rpcConnection!.sendRequest(
        "getCodeplanAgentSolution",
        request,
      );

      vscode.commands.executeCommand("konveyor.loadSolution", response, {
        incidents,
        violation,
      });
    } catch (err: any) {
      this.outputChannel.appendLine(`Error during getSolution: ${err.message}`);
      vscode.window.showErrorMessage("Get solution failed. See the output channel for details.");
    }

    this.fireSolutionStateChange(false);
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
  public async getKaiRpcServerEnv(): Promise<NodeJS.ProcessEnv> {
    const genAiKey = await getGenAiKey(this.extContext);

    return {
      ...process.env,
      GENAI_KEY: genAiKey,
    };
  }

  public getKaiRpcServerPath(): string {
    const path = getConfigKaiRpcServerPath() || this.assetPaths.kaiRpcServer;

    if (!fs.existsSync(path)) {
      const message = `Kai RPC Server binary doesn't exist at ${path}`;
      this.outputChannel.appendLine(`Error: ${message}`);
      vscode.window.showErrorMessage(message);
      throw new Error(message);
    }

    return path;
  }

  // TODO: With konveyor/kai#526, config.toml will be dropped.  Different cli arguments to configure
  // TODO: logging levels and directories are expected.
  public getKaiRpcServerArgs(): string[] {
    return ["--config", this.getKaiConfigTomlPath()];
  }

  /**
   * Until konveyor/kai#509 is resolved, return the single root directory for all of the
   * rulesets yaml files to provide to the analyzer.  After the issue is resolve, send all
   * of the rulesets directories either as `string[]` or as a joined list.
   */
  public getRulesetsPath(): string {
    const includedRulesets = this.assetPaths.rulesets;

    // TODO(djzager): konveyor/kai#509
    // const useDefaultRulesets = getConfigUseDefaultRulesets();
    // const customRules = getConfigCustomRules();
    // const rules: string[] = [];

    // if (useDefaultRulesets) {
    //   rules.push(includedRulesets);
    // }
    // if (customRules.length > 0) {
    //   rules.push(...customRules);
    // }
    // return rules;

    return includedRulesets;
  }

  // New method to retrieve stored rulesets
  public getStoredRulesets(): RuleSet[] | null {
    if (this.extContext) {
      const storedRulesets = this.extContext.globalState.get("storedRulesets");
      return storedRulesets ? JSON.parse(storedRulesets as string) : null;
    }
    return null;
  }

  // TODO: With konveyor/kai#526, config.toml will be dropped.  This won't be needed after that
  // TODO: change is released.
  public getKaiConfigTomlPath(): string {
    // Ensure the file exists with default content if it doesn't
    // Consider making this more robust, maybe this is an asset we can get from kai?
    if (!fs.existsSync(this.kaiConfigToml)) {
      fs.writeFileSync(this.kaiConfigToml, this.defaultKaiConfigToml(this.kaiDir));
    }

    return this.kaiConfigToml;
  }

  // TODO: With konveyor/kai#526, config.toml will be dropped.  This won't be needed after that
  // TODO: change is released.
  public defaultKaiConfigToml(log_dir: string) {
    return `
log_level = "info"
file_log_level = "debug"
log_dir = "${log_dir}"

# These values are needed to start the server but shouldn't be used by the server
# please ignore
[models]
provider = "ChatIBMGenAI"

[models.args]
model_id = "meta-llama/llama-3-70b-instruct"
parameters.max_new_tokens = "2048"
`;
  }
}
