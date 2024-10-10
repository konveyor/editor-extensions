import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import { registerAllCommands } from "./commands";
import { setupWebviewMessageListener } from "./webviewMessageHandler";
import { ExtensionState, SharedState } from "./extensionState";
import { mockResults } from "./webview/mockResults";
import { ViolationCodeActionProvider } from "./ViolationCodeActionProvider";

export class VsCodeExtension {
  private extensionContext: vscode.ExtensionContext;
  private windowId: string;
  private state: ExtensionState;

  constructor(context: vscode.ExtensionContext) {
    this.extensionContext = context;
    this.windowId = uuidv4();

    this.state = {
      sharedState: new SharedState(),
      webviewProviders: new Set<KonveyorGUIWebviewViewProvider>(),
      sidebarProvider: undefined as any,
      extensionContext: context,
    };

    const sidebarProvider = new KonveyorGUIWebviewViewProvider(this.windowId, this.state);

    this.state.sidebarProvider = sidebarProvider;
    this.state.webviewProviders.add(sidebarProvider);

    // Check for multi-root workspace
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) {
      vscode.window.showWarningMessage(
        "Konveyor does not currently support multi-root workspaces. Only the first workspace folder will be analyzed.",
      );
    }

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("konveyor.konveyorGUIView", sidebarProvider, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }),
    );

    sidebarProvider.onWebviewReady((webview) => {
      setupWebviewMessageListener(webview, this.state);
    });
    //DEBUG USE ONLY
    setTimeout(() => {
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
      const updatedResults = mockResults.map((ruleset: any) => {
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

      mockResults.forEach((ruleset: any) => {
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
      sidebarProvider?.webview?.postMessage({
        type: "analysisComplete",
        data: mockResults,
      });
    }, 5000);
    //

    registerAllCommands(this.state);

    const languagesToRegister = ["java"];

    for (const language of languagesToRegister) {
      context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider(language, new ViolationCodeActionProvider(), {
          providedCodeActionKinds: ViolationCodeActionProvider.providedCodeActionKinds,
        }),
      );
    }
  }
}
