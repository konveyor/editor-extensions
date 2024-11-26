import { ChildProcessWithoutNullStreams, exec, spawn } from "child_process";
import * as vscode from "vscode";
import * as os from "os";
import * as fs from "fs";
import * as rpc from "vscode-jsonrpc/node";
import path from "path";
import { Incident, RuleSet, SolutionResponse, Violation } from "@editor-extensions/shared";
import { buildDataFolderPath } from "../data";
import { ExtensionState } from "src/extensionState";

export class AnalyzerClient {
  private config: vscode.WorkspaceConfiguration | null = null;
  private extContext: vscode.ExtensionContext | null = null;
  private kaiRpcServer: ChildProcessWithoutNullStreams | null = null;
  private outputChannel: vscode.OutputChannel;
  private rpcConnection: rpc.MessageConnection | null = null;
  private requestId: number = 1;
  private kaiDir: string;
  private kaiConfigToml: string;

  constructor(context: vscode.ExtensionContext) {
    this.extContext = context;
    this.outputChannel = vscode.window.createOutputChannel("Konveyor-Analyzer");
    this.config = vscode.workspace.getConfiguration("konveyor");
    this.kaiDir = path.join(buildDataFolderPath()!, "kai");
    this.kaiConfigToml = path.join(this.kaiDir, "kai-config.toml");
  }

  public async start(state: ExtensionState): Promise<void> {
    state.mutateData((draft) => {
      draft.isStartingServer = true;
    });

    if (!this.canAnalyze()) {
      return;
    }

    exec("java -version", (err) => {
      if (err) {
        vscode.window.showErrorMessage("Java is not installed. Please install it to continue.");
        return;
      }
    });
    exec("mvn -version", (err) => {
      if (err) {
        vscode.window.showErrorMessage("Maven is not installed. Please install it to continue.");
        return;
      }
    });
    this.kaiRpcServer = spawn(this.getKaiRpcServerPath(), this.getKaiRpcServerArgs(), {
      cwd: this.extContext!.extensionPath,
      env: { ...process.env, GENAI_KEY: "BWAHAHA" },
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
    await new Promise<void>((res) => {
      setTimeout(() => {
        state.mutateData((draft) => {
          draft.isStartingServer = false;
        });
        res();
      }, 30000);
    });

    this.outputChannel.appendLine(`Successfully waited 30 seconds`);
  }

  // Stops the analyzer server
  public stop(): void {
    if (this.kaiRpcServer) {
      this.kaiRpcServer.kill();
    }
    this.rpcConnection?.dispose();
    this.kaiRpcServer = null;
  }

  public async initialize(state: ExtensionState): Promise<void> {
    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      return;
    }

    // Define the initialize request parameters if needed
    const initializeParams = {
      process_id: null,
      kai_backend_url: "0.0.0.0:8080",
      root_path: vscode.workspace.workspaceFolders![0].uri.fsPath,
      log_level: "debug",
      log_dir_path: this.kaiDir,
      model_provider: {
        provider: "ChatOpenAI",
        args: {
          model: "gpt-3.5-turbo",
          // parameters: {
          //   max_new_tokens: 2048,
          // },
        },
      },
      file_log_level: "debug",
      demo_mode: true,
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
            progress.report({ message: "Sending 'initialize' request to RPC Server" });
            const response = await this.rpcConnection!.sendRequest<void>(
              "initialize",
              initializeParams,
            );
            this.outputChannel.appendLine(`${response}`);
            progress.report({ message: "RPC Server initialized" });
            break;
          } catch (err: any) {
            this.outputChannel.appendLine(`Error: ${err}`);
            await new Promise((res) => setTimeout(res, 1000));
            continue;
          }
        }
        progress.report({ message: "Kai initialization failed!" });
      },
    );
  }

  public async runAnalysis(webview: vscode.Webview, state: ExtensionState): Promise<any> {
    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      return;
    }

    state.mutateData((draft) => {
      draft.isAnalyzing = true;
    });

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Running Analysis",
        cancellable: false,
      },
      (progress) => {
        return new Promise<void>((resolve, reject) => {
          (async () => {
            try {
              progress.report({ message: "Running..." });

              const requestParams = {
                label_selector: this.getLabelSelector(),
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
                vscode.window.showInformationMessage(
                  "Analysis completed, but no RuleSets were found.",
                );
                state.mutateData((draft) => {
                  draft.isAnalyzing = false;
                });

                resolve();
                return;
              }

              vscode.commands.executeCommand("konveyor.loadRuleSets", rulesets);
              state.mutateData((draft) => {
                draft.isAnalyzing = false;
              });
              progress.report({ message: "Results processed!" });
              vscode.window.showInformationMessage("Analysis completed successfully!");
              resolve();
            } catch (err: any) {
              this.outputChannel.appendLine(`Error during analysis: ${err.message}`);
              state.mutateData((draft) => {
                draft.isAnalyzing = false;
              });
              vscode.window.showErrorMessage(
                "Analysis failed. See the output channel for details.",
              );
              reject(err);
            }
          })();
        });
      },
    );
  }

  public async getSolution(
    _state: ExtensionState,
    _incident: Incident,
    _violation: Violation,
  ): Promise<any> {
    if (!this.rpcConnection) {
      vscode.window.showErrorMessage("RPC connection is not established.");
      return;
    }

    _state.mutateData((draft) => {
      draft.isFetchingSolution = true;
    });

    const enhancedIncident = {
      ..._incident,
      ruleset_name: _violation.category || "default_ruleset", // You may adjust the default value as necessary
      violation_name: _violation.description || "default_violation", // You may adjust the default value as necessary
    };
    console.log("what is the violation? ", _violation);
    console.log("what is the incident? ", _incident);

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

      console.log("response", response, _incident, _state);
      const enhancedResponse: SolutionResponse = {
        ...response,
        incident: _incident,
        violation: _violation,
      };
      vscode.commands.executeCommand("konveyor.loadSolution", enhancedResponse);
      _state.mutateData((draft) => {
        draft.solutionData = enhancedResponse;
        draft.isFetchingSolution = false;
      });
    } catch (err: any) {
      console.log("response err", err);
      console.log("err incident", _incident);
      this.outputChannel.appendLine(`Error during getSolution: ${err.message}`);
      vscode.window.showErrorMessage("Get solution failed. See the output channel for details.");
    }
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

  public async canAnalyze(): Promise<boolean> {
    const labelSelector = this.config!.get("labelSelector") as string;

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
          await this.config!.update(
            "useDefaultRulesets",
            true,
            vscode.ConfigurationTarget.Workspace,
          );
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
    const analyzerPath = this.config?.get<string>("analyzerPath");
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
    const rpcServerPath = this.config?.get<string>("kaiRpcServerPath");
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

  public getNumWorkers(): number {
    return this.config!.get("workers") as number;
  }

  public getIncidentLimit(): number {
    return this.config!.get("incidentLimit") as number;
  }

  public getContextLines(): number {
    return this.config!.get("contextLines") as number;
  }

  public getCodeSnipLimit(): number {
    return this.config!.get("codeSnipLimit") as number;
  }

  public getRules(): string {
    return path.join(this.extContext!.extensionPath, "assets/rulesets");
    // const useDefaultRulesets = this.config!.get("useDefaultRulesets") as boolean;
    // const customRules = this.config!.get("customRules") as string[];
    // const rules: string[] = [];

    // if (useDefaultRulesets) {
    //   rules.push(path.join(this.extContext!.extensionPath, "assets/rulesets"));
    // }
    // if (customRules.length > 0) {
    //   rules.push(...customRules);
    // }
    // return rules;
  }

  public getLabelSelector(): string {
    return vscode.workspace.getConfiguration("konveyor").get("labelSelector") as string;
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
provider = "ChatIBMGenAI"

[models.args]
model_id = "meta-llama/llama-3-70b-instruct"
parameters.max_new_tokens = "2048"
`;
  }
}
