import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as vscode from "vscode";
import * as os from "os";
import * as fs from "fs";
import * as rpc from "vscode-jsonrpc/node";
import path from "path";
import { Incident, RuleSet, SolutionResponse, Violation } from "@editor-extensions/shared";
import { buildDataFolderPath } from "../data";
import { Extension } from "../helpers/Extension";
import { ExtensionState } from "../extensionState";
import { ExtensionData, ServerState } from "@editor-extensions/shared";
import { setTimeout } from "timers/promises";
import {
  KONVEYOR_CONFIG_KEY,
  getConfigAnalyzerPath,
  getConfigKaiRpcServerPath,
  getConfigKaiBackendURL,
  getConfigLogLevel,
  getConfigKaiProviderName,
  getConfigKaiProviderArgs,
  getConfigLabelSelector,
  updateUseDefaultRuleSets,
} from "../utilities";

export class AnalyzerClient {
  private kaiRpcServer: ChildProcessWithoutNullStreams | null = null;
  private outputChannel: vscode.OutputChannel;
  private rpcConnection: rpc.MessageConnection | null = null;
  private requestId: number = 1;
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
    this.outputChannel = vscode.window.createOutputChannel("Konveyor-Analyzer");
    this.kaiDir = path.join(buildDataFolderPath()!, "kai");
    this.kaiConfigToml = path.join(this.kaiDir, "kai-config.toml");
  }

  public async start(): Promise<void> {
    if (!this.canAnalyze()) {
      vscode.window.showErrorMessage("Cannot start the server due to missing configuration.");
      return;
    }

    this.fireStateChange("starting");
    this.outputChannel.appendLine(`Starting the server ...`);

    this.kaiRpcServer = spawn(this.getKaiRpcServerPath(), this.getKaiRpcServerArgs(), {
      cwd: this.extContext!.extensionPath,
      env: {
        ...process.env,
        GENAI_KEY: "BWAHAHA",
      },
    });

    this.kaiRpcServer.stderr.on("data", (data) => {
      this.outputChannel.appendLine(`${data.toString()}`);
    });

    this.kaiRpcServer.on("exit", (code) => {
      this.outputChannel.appendLine(`Analyzer exited with code ${code}`);
    });

    // Set up the JSON-RPC connection
    this.rpcConnection = rpc.createMessageConnection(
      new rpc.StreamMessageReader(this.kaiRpcServer.stdout),
      new rpc.StreamMessageWriter(this.kaiRpcServer.stdin),
    );
    this.rpcConnection.listen();
  }

  // Stops the analyzer server
  public stop(): void {
    this.fireStateChange("stopping");
    this.outputChannel.appendLine(`Stopping the server ...`);
    if (this.kaiRpcServer) {
      this.kaiRpcServer.kill();
    }
    this.rpcConnection?.dispose();
    this.kaiRpcServer = null;
    this.fireStateChange("stopped");
    this.outputChannel.appendLine(`Server stopped`);
  }

  public async initialize(): Promise<void> {
    // This config value is intentionally excluded from package.json
    const configDemoMode = vscode.workspace
      .getConfiguration(KONVEYOR_CONFIG_KEY)
      ?.get<boolean>("konveyor.kai.demoMode");
    let demoMode: boolean;
    if (configDemoMode !== undefined) {
      demoMode = configDemoMode;
    } else {
      demoMode = !Extension.getInstance(this.extContext).isProductionMode;
    }

    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      return;
    }

    // Define the initialize request parameters if needed
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
      demo_mode: demoMode,
      cache_dir: "",

      analyzer_lsp_java_bundle_path: path.join(
        this.extContext!.extensionPath,
        "assets/bin/jdtls/java-analyzer-bundle/java-analyzer-bundle.core/target/java-analyzer-bundle.core-1.0.0-SNAPSHOT.jar",
      ),
      analyzer_lsp_lsp_path: path.join(
        this.extContext!.extensionPath,
        "assets",
        "bin",
        "jdtls",
        "bin",
        "jdtls",
      ),
      analyzer_lsp_rpc_path: this.getAnalyzerPath(),
      analyzer_lsp_rules_path: this.getRules(),
      analyzer_lsp_dep_labels_path: path.join(
        this.extContext!.extensionPath,
        "assets/bin/jdtls/java-analyzer-bundle/maven.default.index",
      ),
    };

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
            this.outputChannel.appendLine(`${response}`);
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

  public async runAnalysis(): Promise<any> {
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

          vscode.commands.executeCommand("konveyor.loadRuleSets", rulesets);
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
      await this.rpcConnection!.sendRequest("shutdown", {});
    } catch (err: any) {
      this.outputChannel.appendLine(`Error during shutdown: ${err.message}`);
      vscode.window.showErrorMessage("Shutdown failed. See the output channel for details.");
    }
  }

  // Exit the server
  public async exit(): Promise<void> {
    try {
      await this.rpcConnection!.sendRequest("exit", {});
    } catch (err: any) {
      this.outputChannel.appendLine(`Error during exit: ${err.message}`);
      vscode.window.showErrorMessage("Exit failed. See the output channel for details.");
    }
  }

  public canAnalyze(): boolean {
    return !!getConfigLabelSelector() && this.getRules().length !== 0;
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

    if (this.getRules().length === 0) {
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
    const analyzerPath = getConfigAnalyzerPath();
    if (analyzerPath && fs.existsSync(analyzerPath)) {
      return analyzerPath;
    }

    const platform = os.platform();
    const arch = os.arch();

    let binaryName = `kai-analyzer-rpc.${platform}.${arch}`;
    if (platform === "win32") {
      binaryName += ".exe";
    }

    // Full path to the analyzer binary
    const defaultAnalyzerPath = path.join(
      this.extContext!.extensionPath,
      "assets",
      "bin",
      binaryName,
    );

    // Check if the binary exists
    if (!fs.existsSync(defaultAnalyzerPath)) {
      vscode.window.showErrorMessage(`Analyzer binary doesn't exist at ${defaultAnalyzerPath}`);
    }

    return defaultAnalyzerPath;
  }

  public getKaiRpcServerPath(): string {
    // Retrieve the rpcServerPath
    const rpcServerPath = getConfigKaiRpcServerPath();
    if (rpcServerPath && fs.existsSync(rpcServerPath)) {
      return rpcServerPath;
    }
    // Might not needed.
    // Fallback to default rpc-server binary path if user did not provid path
    const platform = os.platform();
    const arch = os.arch();

    let binaryName = `kai-rpc-server.${platform}.${arch}`;
    if (platform === "win32") {
      binaryName += ".exe";
    }

    // Construct the full path
    const defaultRpcServerPath = path.join(
      this.extContext!.extensionPath,
      "assets",
      "bin",
      binaryName,
    );

    // Check if the default rpc-server binary exists, else show an error message
    if (!fs.existsSync(defaultRpcServerPath)) {
      vscode.window.showErrorMessage(`RPC server binary doesn't exist at ${defaultRpcServerPath}`);
      throw new Error(`RPC server binary not found at ${defaultRpcServerPath}`);
    }

    // Return the default path
    return defaultRpcServerPath;
  }

  public getKaiRpcServerArgs(): string[] {
    return ["--config", this.getKaiConfigTomlPath()];
  }

  public getRules(): string {
    return path.join(this.extContext!.extensionPath, "assets/rulesets");
    // TODO(djzager): konveyor/kai#509
    // const useDefaultRulesets = getConfigUseDefaultRulesets();
    // const customRules = getConfigCustomRules();
    // const rules: string[] = [];

    // if (useDefaultRulesets) {
    //   rules.push(path.join(this.extContext!.extensionPath, "assets/rulesets"));
    // }
    // if (customRules.length > 0) {
    //   rules.push(...customRules);
    // }
    // return rules;
  }

  public getJavaConfig(): object {
    return {
      bundles: path.join(
        this.extContext!.extensionPath,
        "assets/bin/jdtls/java-analyzer-bundle/java-analyzer-bundle.core/target/java-analyzer-bundle.core-1.0.0-SNAPSHOT.jar",
      ),
      lspServerPath: path.join(this.extContext!.extensionPath, "assets/bin/jdtls/bin/jdtls"),
    };
  }

  // New method to retrieve stored rulesets
  public getStoredRulesets(): RuleSet[] | null {
    if (this.extContext) {
      const storedRulesets = this.extContext.globalState.get("storedRulesets");
      return storedRulesets ? JSON.parse(storedRulesets as string) : null;
    }
    return null;
  }

  public isServerRunning(): boolean {
    return !!this.kaiRpcServer && !this.kaiRpcServer.killed;
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
provider = "ChatIBMGenAI

[models.args]
model_id = "meta-llama/llama-3-70b-instruct"
parameters.max_new_tokens = "2048"

`;
  }
}
