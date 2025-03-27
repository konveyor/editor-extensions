import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import { EnhancedIncident } from "@editor-extensions/shared";
import { Immutable } from "immer";
import { getConfigPromptTemplate } from "./utilities/configuration";
import Mustache from "mustache";

export class ViolationCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private state: ExtensionState) {}

  private findMatchingIncident(
    diagnostic: vscode.Diagnostic,
  ): Immutable<EnhancedIncident> | undefined {
    if (typeof diagnostic.code !== "string") {
      console.error("Diagnostic code is not a string:", diagnostic.code);
      return undefined;
    }

    const [violationId, uri, lineNumberStr] = diagnostic.code.split("-");
    const lineNumber = parseInt(lineNumberStr, 10);

    if (!violationId || !uri || isNaN(lineNumber)) {
      console.error("Diagnostic code is malformed:", diagnostic.code);
      return undefined;
    }

    const matchingIncidents = this.state.data.enhancedIncidents.filter(
      (incident) =>
        incident.violationId === violationId &&
        incident.uri === uri &&
        incident.lineNumber === lineNumber,
    );

    if (matchingIncidents.length !== 1) {
      console.error(
        `Expected exactly one matching incident, but found ${matchingIncidents.length} for diagnostic code:`,
        diagnostic.code,
      );
      return undefined;
    }

    return matchingIncidents[0];
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
      if (diagnostic.source === "konveyor") {
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
