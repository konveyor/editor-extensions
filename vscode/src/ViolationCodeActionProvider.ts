import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import { EnhancedIncident } from "@editor-extensions/shared";
import { Immutable } from "immer";
import { getConfigPromptTemplate } from "./utilities/configuration";
import Mustache from "mustache";
import { DiagnosticSource } from "@editor-extensions/shared";
export class ViolationCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private state: ExtensionState) {}

  private findMatchingIncident(
    diagnostic: vscode.Diagnostic,
  ): Immutable<EnhancedIncident> | undefined {
    if (typeof diagnostic.code !== "string") {
      return undefined;
    }
    const index = parseInt(diagnostic.code, 10);

    if (isNaN(index)) {
      console.error("Invalid index in diagnostic code:", diagnostic.code);
      return undefined;
    }

    // Get the incident at the specified index
    const incidents = this.state.data.enhancedIncidents;
    if (index < 0 || index >= incidents.length) {
      console.error(
        `Index ${index} is out of range for incidents array (length: ${incidents.length})`,
      );
      return undefined;
    }

    const incident = incidents[index];

    return incident;
  }

  async provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];
    const continueExt = vscode.extensions.getExtension("Continue.continue");

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source === DiagnosticSource) {
        const incident = this.findMatchingIncident(diagnostic);
        if (incident) {
          // Add Ask Kai action
          const askKaiAction = new vscode.CodeAction("Ask Kai", vscode.CodeActionKind.QuickFix);
          askKaiAction.command = {
            command: "konveyor.getSolution",
            title: "Ask Kai",
            arguments: [[incident], this.state.data.solutionEffort],
          };
          askKaiAction.diagnostics = [diagnostic];
          askKaiAction.isPreferred = true;
          actions.push(askKaiAction);

          // Add Ask Continue action if Continue is installed
          if (continueExt) {
            const askContinueAction = new vscode.CodeAction(
              "Ask Continue with Konveyor Context",
              vscode.CodeActionKind.QuickFix,
            );
            const promptTemplate = getConfigPromptTemplate();
            const prompt = Mustache.render(promptTemplate, incident);

            // Create a range that includes 5 lines before and after the diagnostic
            const surroundingRange = new vscode.Range(
              Math.max(0, diagnostic.range.start.line - 5),
              0,
              Math.min(document.lineCount - 1, diagnostic.range.end.line + 5),
              0,
            );

            askContinueAction.command = {
              command: "continue.customQuickActionSendToChat",
              title: "Ask Continue with Konveyor Context",
              arguments: [prompt, surroundingRange],
            };
            askContinueAction.diagnostics = [diagnostic];
            actions.push(askContinueAction);
          }
        }
      }
    }

    return actions;
  }
}
