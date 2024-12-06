import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { setTimeout } from "node:timers/promises";
import * as vscode from "vscode";
import * as rpc from "vscode-jsonrpc/node";
import { Incident, RuleSet, SolutionResponse, Violation } from "@editor-extensions/shared";
import { ExtensionData, ServerState } from "@editor-extensions/shared";
import { buildDataFolderPath } from "../data";
import { Extension } from "../helpers/Extension";
import { ExtensionState } from "../extensionState";
import { buildAssetPaths, AssetPaths } from "./paths";
import {
  KONVEYOR_CONFIG_KEY,
  getConfigKaiBackendURL,
  getConfigLogLevel,
  getConfigKaiProviderName,
  getConfigKaiProviderArgs,
  getConfigLabelSelector,
  updateUseDefaultRuleSets,
  getConfigKaiRpcServerPath,
  getConfigAnalyzerPath,
} from "../utilities";

export class AnalyzerClient {
  private kaiRpcServer: ChildProcessWithoutNullStreams | null = null;
  private rpcConnection: rpc.MessageConnection | null = null;

  private outputChannel: vscode.OutputChannel;
  private assetPaths: AssetPaths;
  private kaiDir: string;
  private kaiConfigToml: string;
  private fireStateChange: (state: ServerState) => void;
  private fireAnalysisStateChange: (flag: boolean) => void;
  private fireSolutionStateChange: (flag: boolean) => void;

  constructor(
    private extContext: vscode.ExtensionContext,
    mutateExtensionState: (recipe: (draft: ExtensionData) => void) => void,
  ) {
    this.fireStateChange = (state: ServerState) =>
      mutateExtensionState((draft) => {
        draft.serverState = state;
        draft.isStartingServer = state === "starting";
      });
    this.fireAnalysisStateChange = (flag: boolean) =>
      mutateExtensionState((draft) => {
        draft.isAnalyzing = flag;
      });
    this.fireSolutionStateChange = (flag: boolean) =>
      mutateExtensionState((draft) => {
        draft.isFetchingSolution = flag;
      });

    this.outputChannel = vscode.window.createOutputChannel("Konveyor-Analyzer"); //, { log: true });

    this.assetPaths = buildAssetPaths(extContext);
    this.kaiDir = path.join(buildDataFolderPath()!, "kai");
    this.kaiConfigToml = path.join(this.kaiDir, "kai-config.toml");

    this.outputChannel.appendLine(
      `current asset paths: ${JSON.stringify(this.assetPaths, null, 2)}`,
    );
    this.outputChannel.appendLine(`Kai directory: ${this.kaiDir}`);
    this.outputChannel.appendLine(`Kai config toml: ${this.kaiConfigToml}`);
  }

  public async start(): Promise<void> {
    if (!this.canAnalyze()) {
      vscode.window.showErrorMessage(
        "Cannot start the kai rpc server due to missing configuration.",
      );
      return;
    }

    // TODO: If the server generates files in cwd, we should set this to something else
    const serverCwd = this.extContext.extensionPath;

    this.fireStateChange("starting");
    this.outputChannel.appendLine(`Starting the kai rpc server ...`);
    this.outputChannel.appendLine(`server cwd: ${serverCwd}`);
    this.outputChannel.appendLine(`server path: ${this.getKaiRpcServerPath()}`);
    this.outputChannel.appendLine(`server args:`);
    this.getKaiRpcServerArgs().forEach((arg) => this.outputChannel.appendLine(`   ${arg}`));

    const kaiRpcServer = spawn(this.getKaiRpcServerPath(), this.getKaiRpcServerArgs(), {
      cwd: serverCwd,
      env: this.getKaiRpcServerEnv(),
    });
    this.kaiRpcServer = kaiRpcServer;

    const pid = await new Promise<number | undefined>((resolve, reject) => {
      kaiRpcServer.on("spawn", () => {
        this.outputChannel.appendLine(
          `kai rpc server has been spawned! [${this.kaiRpcServer?.pid}]`,
        );
        resolve(this.kaiRpcServer?.pid);
      });

      kaiRpcServer.on("error", (err) => {
        const message = `error in process[${this.kaiRpcServer?.spawnfile}]: ${err}`;
        this.outputChannel.appendLine(`[error] - ${message}}`);
        reject();
      });
    });

    this.kaiRpcServer.on("exit", (code, signal) => {
      this.outputChannel.appendLine(`kai rpc server exited with signal ${signal}, code ${code}`);
    });

    this.kaiRpcServer.on("close", (code, signal) => {
      this.outputChannel.appendLine(`kai rpc server closed with signal ${signal}, code ${code}`);
      this.fireStateChange("stopped");
    });

    let seenServerIsReady = false;
    this.kaiRpcServer.stderr.on("data", (data) => {
      const asString: string = data.toString();
      this.outputChannel.appendLine(`${asString}`);

      if (!seenServerIsReady && asString.match(/kai-rpc-logger .*Started kai RPC Server/)) {
        seenServerIsReady = true;
        this.kaiRpcServer?.emit("serverReportsReady", pid);
      }
    });

    // Set up the JSON-RPC connection
    this.rpcConnection = rpc.createMessageConnection(
      new rpc.StreamMessageReader(this.kaiRpcServer.stdout),
      new rpc.StreamMessageWriter(this.kaiRpcServer.stdin),
    );
    this.rpcConnection.listen();

    await Promise.race([
      new Promise<void>((resolve) => {
        kaiRpcServer.on("serverReportsReady", (pid) => {
          this.outputChannel.appendLine(`*** kai rpc server [${pid}] reports ready`);
          resolve();
        });
      }),
      setTimeout(5000),
    ]);

    this.outputChannel.appendLine(`Started the kai rpc server, pid: [${pid}]`);
  }

  // Stops the analyzer server
  public stop(): void {
    this.fireStateChange("stopping");
    this.outputChannel.appendLine(`Stopping the kai rpc server ...`);
    if (this.kaiRpcServer && !this.kaiRpcServer.killed) {
      this.kaiRpcServer.kill();
    }
    this.rpcConnection?.dispose();
    this.kaiRpcServer = null;
    this.outputChannel.appendLine(`kai rpc server stopped`);
  }

  // This config value is intentionally excluded from package.json
  protected isDemoMode(): boolean {
    const configDemoMode = vscode.workspace
      .getConfiguration(KONVEYOR_CONFIG_KEY)
      ?.get<boolean>("konveyor.kai.demoMode");

    let demoMode: boolean;
    if (configDemoMode !== undefined) {
      demoMode = configDemoMode;
    } else {
      demoMode = !Extension.getInstance(this.extContext).isProductionMode;
    }
    return demoMode;
  }

  public async initialize(): Promise<void> {
    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      return;
    }

    // Define the initialize request parameters
    const initializeParams = {
      process_id: null,
      kai_backend_url: getConfigKaiBackendURL(),
      root_path: vscode.workspace.workspaceFolders![0].uri.fsPath,
      log_level: getConfigLogLevel(),
      log_dir_path: this.kaiDir,
      model_provider: {
        provider: getConfigKaiProviderName(),
        args: getConfigKaiProviderArgs(),
      },
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

    this.outputChannel.appendLine(
      `initialize payload: ${JSON.stringify(initializeParams, null, 2)}`,
    );

    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Initializing Kai",
        cancellable: true,
      },
      async (progress) => {
        for (let attempt = 0; attempt < 10; attempt++) {
          this.outputChannel.appendLine("Sending 'initialize' request.");
          try {
            progress.report({
              message: "Sending 'initialize' request to RPC Server",
            });
            const response = await this.rpcConnection!.sendRequest<void>(
              "initialize",
              initializeParams,
            );
            this.outputChannel.appendLine(
              `'initialize' response: ${JSON.stringify(response, null, 2)}`,
            );
            progress.report({ message: "RPC Server initialized" });
            this.fireStateChange("running");
            return;
          } catch (err: any) {
            this.outputChannel.appendLine(`Error: ${err}`);
            await setTimeout(1000);
            continue;
          }
        }
        progress.report({ message: "Kai initialization failed!" });
        this.fireStateChange("startFailed");
      },
    );
  }

  public isServerRunning(): boolean {
    return !!this.kaiRpcServer && !this.kaiRpcServer.killed;
  }

  public async runAnalysis(filePaths?: string[]): Promise<any> {
    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Running Analysis",
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ message: "Running..." });
          this.fireAnalysisStateChange(true);

          const requestParams = {
            label_selector: getConfigLabelSelector(),
            included_paths: filePaths,
          };

          this.outputChannel.appendLine(
            `Sending 'analysis_engine.Analyze' request with params: ${JSON.stringify(
              requestParams,
            )}`,
          );

          const response: any = await this.rpcConnection!.sendRequest(
            "analysis_engine.Analyze",
            requestParams,
          );

          this.outputChannel.appendLine(`Response: ${JSON.stringify(response)}`);

          // Handle the result
          const rulesets = response?.Rulesets as RuleSet[];
          if (!rulesets || rulesets.length === 0) {
            vscode.window.showInformationMessage("Analysis completed, but no RuleSets were found.");
            this.fireAnalysisStateChange(false);
            return;
          }

          vscode.commands.executeCommand("konveyor.loadRuleSets", rulesets, filePaths);
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

  public async getSolution(
    state: ExtensionState,
    incident: Incident,
    violation: Violation,
  ): Promise<any> {
    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      return;
    }

    this.fireSolutionStateChange(true);

    const enhancedIncident = {
      ...incident,
      ruleset_name: violation.category || "default_ruleset", // You may adjust the default value as necessary
      violation_name: violation.description || "default_violation", // You may adjust the default value as necessary
    };

    try {
      const response: SolutionResponse = await this.rpcConnection!.sendRequest(
        "getCodeplanAgentSolution",
        {
          file_path: "",
          incidents: [enhancedIncident],
          max_priority: 0,
          max_depth: 0,
          max_iterations: 1,
        },
      );

      vscode.commands.executeCommand("konveyor.loadSolution", response, {
        incident,
        violation,
      });
    } catch (err: any) {
      this.outputChannel.appendLine(`Error during getSolution: ${err.message}`);
      vscode.window.showErrorMessage("Get solution failed. See the output channel for details.");
    }
    this.fireSolutionStateChange(false);
  }

  // Shutdown the server
  public async shutdown(): Promise<void> {
    try {
      this.outputChannel.appendLine(`Requesting kai rpc server shutdown...`);
      await this.rpcConnection?.sendRequest("shutdown", {});
    } catch (err: any) {
      this.outputChannel.appendLine(`Error during shutdown: ${err.message}`);
      vscode.window.showErrorMessage("Shutdown failed. See the output channel for details.");
    }
  }

  // Exit the server
  public async exit(): Promise<void> {
    try {
      this.outputChannel.appendLine(`Requesting kai rpc server exit...`);
      await this.rpcConnection?.sendRequest("exit", {});
    } catch (err: any) {
      this.outputChannel.appendLine(`Error during exit: ${err.message}`);
      vscode.window.showErrorMessage("Exit failed. See the output channel for details.");
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
      GENAI_KEY: "dummy",
      ...process.env,
      // TODO: If/when necessary, add new envvars here from configuration
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

  public getKaiConfigDir(): string {
    return this.kaiDir;
  }

  public getKaiConfigTomlPath(): string {
    if (!fs.existsSync(this.kaiDir)) {
      fs.mkdirSync(this.kaiDir, { recursive: true });
    }

    // Ensure the file exists with default content if it doesn't
    // Consider making this more robust, maybe this is an asset we can get from kai?
    if (!fs.existsSync(this.kaiConfigToml)) {
      fs.writeFileSync(this.kaiConfigToml, this.defaultKaiConfigToml(this.kaiDir));
    }

    return this.kaiConfigToml;
  }

  public defaultKaiConfigToml(log_dir: string) {
    return `log_level = "info"
file_log_level = "debug"
log_dir = "${log_dir}"

[models]
provider = "ChatIBMGenAI"

[models.args]
model_id = "meta-llama/llama-3-70b-instruct"
parameters.max_new_tokens = "2048"

`;
  }
}
