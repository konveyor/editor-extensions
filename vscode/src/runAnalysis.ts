import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as yaml from "js-yaml";
import { AnalysisConfig } from "./webview/types";
import { ExtensionState } from "./extensionState";

export async function runAnalysis(
  state: ExtensionState,
  analysisConfig: AnalysisConfig,
  webview?: vscode.Webview,
): Promise<void> {
  try {
    const { extensionContext: context } = state;
    // Build the arguments for the kantra binary
    const args: string[] = ["analyze", "--provider=java"];

    // Use the input path from the analysis config
    args.push("--input", analysisConfig.inputPath);

    // Add label selector if provided
    if (analysisConfig.labelSelector) {
      args.push("--label-selector", analysisConfig.labelSelector);
    }

    // Add custom rules if provided
    if (analysisConfig.customRules && analysisConfig.customRules.length > 0) {
      analysisConfig.customRules.forEach((rule) => {
        args.push("--rules", rule);
      });
    }

    // Use fsPath to get the correct path as a string
    const outputPath = context.storageUri?.fsPath;
    if (!outputPath) {
      throw new Error("Unable to resolve storage path");
    }

    // Ensure the output directory exists
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }

    args.push("--output", outputPath);
    args.push("--overwrite");

    // Get the path to the kantra binary
    const kantraPath =
      analysisConfig.overrideAnalyzerBinaryPath ||
      context.asAbsolutePath(path.join("assets", "kantra"));

    if (!fs.existsSync(kantraPath)) {
      throw new Error(`Kantra binary not found at path: ${kantraPath}`);
    }
    try {
      fs.accessSync(kantraPath, fs.constants.X_OK);
    } catch (err) {
      throw new Error(`Kantra binary is not executable: ${kantraPath}`);
    }

    // Notify the webview that analysis is starting
    if (webview) {
      webview.postMessage({ type: "analysisStarted" });
    }

    // Use vscode.window.withProgress to show a progress indicator
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Running Analysis",
        cancellable: false,
      },
      async (progress) => {
        return new Promise<void>((resolve, reject) => {
          const outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel("konveyor");
          outputChannel.clear();
          outputChannel.appendLine("Preparing to run analysis...");
          outputChannel.show();

          progress.report({ message: "Initializing..." });

          outputChannel.appendLine(`Running command: ${kantraPath} ${args.join(" ")}`);

          const analysis = cp.spawn(kantraPath, args);

          // Set a timeout to prevent hanging indefinitely
          const analysisTimeout = setTimeout(() => {
            analysis.kill();
            vscode.window.showErrorMessage("Analysis process timed out.");
            outputChannel.appendLine("Analysis process timed out.");
            reject(new Error("Analysis process timed out."));
          }, 300000); // Timeout after 5 minutes

          let stderrData = ""; // Accumulate stderr data
          analysis.stdout.on("data", (data) => {
            outputChannel.append(data.toString());
          });
          analysis.stderr.on("data", (data) => {
            stderrData += data.toString();
          });

          analysis.on("close", (code) => {
            clearTimeout(analysisTimeout);

            if (code !== 0) {
              vscode.window.showErrorMessage(`Analysis failed: ${stderrData}`);
              return reject(new Error(`Analysis failed with code ${code}: ${stderrData}`));
            }

            // Analysis completed successfully
            vscode.window.showInformationMessage("Analysis complete!");
            outputChannel.appendLine("Analysis completed successfully.");

            try {
              // Process the analysis results
              const yamlContent = fs.readFileSync(path.join(outputPath, "output.yaml"), "utf8");
              const analysisResults = yaml.load(yamlContent);
              context.workspaceState.update("analysisResults", analysisResults);

              if (!Array.isArray(analysisResults)) {
                throw new Error("Expected an array of RuleSets in the output.");
              }
              outputChannel.appendLine("Processing analysis output.yaml");

              const diagnosticCollection = vscode.languages.createDiagnosticCollection("konveyor");

              const workspaceFolderPath = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

              function updateIncidentPaths(incidents: any[], workspaceFolderPath: string): any[] {
                return incidents.map((incident) => {
                  if (incident.uri.startsWith("file:///opt/input/source")) {
                    incident.uri = incident.uri.replace(
                      "file:///opt/input/source",
                      vscode.Uri.file(workspaceFolderPath).toString(),
                    );
                  }
                  return incident;
                });
              }

              // Update incident paths
              const updatedResults = analysisResults.map((ruleset: any) => {
                const violations = ruleset.violations ?? {};
                Object.keys(violations).forEach((ruleId) => {
                  const incidents = violations[ruleId].incidents;
                  if (incidents) {
                    violations[ruleId].incidents = updateIncidentPaths(
                      incidents,
                      workspaceFolderPath || "",
                    );
                  }
                });
                return ruleset;
              });

              // Prepare diagnostics
              const diagnosticsMap: Map<string, vscode.Diagnostic[]> = new Map();

              analysisResults.forEach((ruleset: any) => {
                Object.keys(ruleset.violations ?? {}).forEach((ruleId) => {
                  const category = ruleset.violations[ruleId].category;

                  ruleset.violations[ruleId].incidents?.forEach((incident: any) => {
                    const fileUriString = incident.uri;
                    const fileUri = vscode.Uri.parse(fileUriString);
                    const fileKey = fileUri.toString();

                    let lineNumber = incident.lineNumber ? incident.lineNumber - 1 : 0;
                    if (lineNumber < 0) {
                      lineNumber = 0;
                    }

                    const severity = (category: string) => {
                      if (category === "mandatory") {
                        return vscode.DiagnosticSeverity.Error;
                      }
                      if (category === "potential") {
                        return vscode.DiagnosticSeverity.Warning;
                      }
                      if (category === "optional") {
                        return vscode.DiagnosticSeverity.Information;
                      }
                      return vscode.DiagnosticSeverity.Hint;
                    };

                    const diagnostic = new vscode.Diagnostic(
                      new vscode.Range(lineNumber, 0, lineNumber, Number.MAX_SAFE_INTEGER),
                      incident.message,
                      severity(category),
                    );

                    // Collect diagnostics per file
                    let diagnostics = diagnosticsMap.get(fileKey);
                    if (!diagnostics) {
                      diagnostics = [];
                      diagnosticsMap.set(fileKey, diagnostics);
                    }
                    diagnostics.push(diagnostic);
                  });
                });
              });

              // Set diagnostics per file
              diagnosticsMap.forEach((diagnostics, fileKey) => {
                const fileUri = vscode.Uri.parse(fileKey);
                diagnosticCollection.set(fileUri, diagnostics);
              });

              vscode.window.showInformationMessage("Diagnostics created.");

              resolve();
              if (webview) {
                webview.postMessage({
                  type: "analysisComplete",
                  data: updatedResults,
                });
              }
            } catch (error: any) {
              vscode.window.showErrorMessage(`Error processing analysis results: ${error.message}`);
              outputChannel.appendLine(`Error: ${error.message}`);
              reject(error);
            }
          });
        });
      },
    );
  } catch (error: any) {
    if (webview) {
      webview.postMessage({
        type: "analysisFailed",
        message: error.message,
      });
    }
    vscode.window.showErrorMessage(`Failed to run analysis: ${error.message}`);
  }
}
