import { ChildProcessWithoutNullStreams, exec, spawn } from "child_process";
import * as vscode from "vscode";
import * as os from "os";
import * as fs from "fs";
import { Incident, RuleSet } from "@editor-extensions/shared";

import path from "path";

export class AnalyzerClient {
  private config: vscode.WorkspaceConfiguration | null = null;
  private extContext: vscode.ExtensionContext | null = null;
  private analyzerServer: ChildProcessWithoutNullStreams | null = null;
  private outputChannel: vscode.OutputChannel;
  // private rpcConnection: rpc.MessageConnection | null = null;
  private requestId: number = 1;

  constructor(context: vscode.ExtensionContext) {
    this.extContext = context;
    this.outputChannel = vscode.window.createOutputChannel("Konveyor-Analyzer");
    this.config = vscode.workspace.getConfiguration("konveyor");
  }

  public start(): void {
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
    this.analyzerServer = spawn(this.getAnalyzerPath(), this.getAnalyzerArgs(), {
      cwd: this.extContext!.extensionPath,
    });

    this.analyzerServer.stderr.on("data", (data) => {
      this.outputChannel.appendLine(`${data.toString()}`);
    });

    this.analyzerServer.on("exit", (code) => {
      this.outputChannel.appendLine(`Analyzer exited with code ${code}`);
    });
  }

  // Stops the analyzer server
  public stop(): void {
    if (this.analyzerServer) {
      this.analyzerServer.kill();
    }
    // this.rpcConnection = null;
    this.analyzerServer = null;
  }

  public async initialize(): Promise<any> {
    vscode.window.showErrorMessage("Not yet implemented");
  }

  public async runAnalysis(webview: vscode.Webview): Promise<any> {
    if (!this.analyzerServer) {
      vscode.window.showErrorMessage("Server not started");
      return;
    }

    if (webview) {
      webview.postMessage({ type: "analysisStarted" });
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Running Analysis",
        cancellable: false,
      },
      async (progress) => {
        return new Promise<void>((resolve, reject) => {
          const requestId = this.requestId++;
          const request =
            JSON.stringify({
              jsonrpc: "2.0",
              id: requestId,
              method: "analysis_engine.Analyze",
              params: [
                {
                  label_selector: this.getLabelSelector(),
                },
              ],
            }) + "\n";

          this.outputChannel.appendLine(`Preparing to analyze with request: ${request}`);
          progress.report({ message: "Running..." });
          this.analyzerServer?.stdin.write(request);

          let dataBuffer = "";
          const analysisTimeout = setTimeout(() => {
            vscode.window.showErrorMessage("Analysis process timed out.");
            this.outputChannel.appendLine("Analysis process timed out.");
            reject(new Error("Analysis process timed out."));
          }, 300000); // Timeout after 5 minutes

          this.analyzerServer!.stdout.on("data", (data) => {
            dataBuffer += data.toString(); // Append incoming data to the buffer

            let newlineIndex;
            // Process all complete lines (JSON-RPC messages)
            while ((newlineIndex = dataBuffer.indexOf("\n")) !== -1) {
              const line = dataBuffer.slice(0, newlineIndex).trim(); // Extract a complete line
              dataBuffer = dataBuffer.slice(newlineIndex + 1); // Remove the processed line

              try {
                const response = JSON.parse(line);

                // Check if the response matches the request ID
                if (response.id === requestId) {
                  clearTimeout(analysisTimeout);
                  progress.report({ message: "Analysis complete!" });

                  const rulesets = response.result["Rulesets"] as RuleSet[];
                  if (rulesets.length === 0) {
                    this.outputChannel.appendLine("No RuleSets from analysis!");
                  }

                  vscode.commands.executeCommand("konveyor.loadRuleSets", rulesets);

                  progress.report({ message: "Results processed!" });

                  resolve();
                }
              } catch (err: any) {
                this.outputChannel.appendLine(`Error parsing analysis result: ${err.message}`);
                reject(err);
              }
            }
          });
        });
      },
    );
  }

  public async getSolution(_webview: vscode.Webview, _incident: Incident): Promise<any> {
    vscode.window.showErrorMessage("Not yet implemented");
  }

  // Shutdown the server
  public async shutdown(): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestId = this.requestId++;
      const request =
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          method: "shutdown",
          params: {},
        }) + "\n";
      this.analyzerServer?.stdin.write(request);
      this.outputChannel.appendLine("Shuting down Server");
      this.analyzerServer?.stdout.on("data", (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === requestId && !response.error) {
            resolve();
          }
        } catch (err: any) {
          reject(err);
        }
      });
    });
  }

  // Exit the server
  public async exit(): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestId = this.requestId++;
      const request =
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          method: "exit",
          params: {},
        }) + "\n";
      this.analyzerServer?.stdin.write(request);
      this.outputChannel.appendLine("Exiting Server");
      this.analyzerServer?.stdout.on("data", (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === requestId && !response.error) {
            resolve();
          }
        } catch (err: any) {
          reject(err);
        }
      });
    });
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

    let binaryName = `kai-analyzer.${platform}.${arch}`;
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

  public getAnalyzerArgs(): string[] {
    return [
      "-source-directory",
      vscode.workspace.workspaceFolders![0].uri.fsPath,
      "-rules-directory",
      this.getRules(),
      "-lspServerPath",
      path.join(this.extContext!.extensionPath, "assets", "bin", "jdtls", "bin", "jdtls"),
      "-bundles",
      path.join(
        this.extContext!.extensionPath,
        "assets/bin/jdtls/java-analyzer-bundle/java-analyzer-bundle.core/target/java-analyzer-bundle.core-1.0.0-SNAPSHOT.jar",
      ),
      "-depOpenSourceLabelsFile",
      path.join(
        this.extContext!.extensionPath,
        "assets/bin/jdtls/java-analyzer-bundle/maven.default.index",
      ),
    ];
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
    return this.config!.get("labelSelector") as string;
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
}
