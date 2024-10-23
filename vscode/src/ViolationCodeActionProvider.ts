import * as vscode from "vscode";

export class ViolationCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source === "AnalysisEngine") {
        const action = this.createQuickFix(document, diagnostic);
        actions.push(action);
      }
    }

    return actions;
  }

  private createQuickFix(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
  ): vscode.CodeAction {
    const action = new vscode.CodeAction("Apply Quick Fix", vscode.CodeActionKind.QuickFix);
    action.edit = new vscode.WorkspaceEdit();

    // Implement the fix logic here
    // For example, replace the problematic code with a suggested fix
    const suggestedCode = diagnostic.message; // You might need to parse this appropriately
    action.edit.replace(document.uri, diagnostic.range, suggestedCode);

    // const fixText = "// TODO: Implement the quick fix here";
    // action.edit.replace(document.uri, incidentRange, fixText);

    // Optionally, specify that the action fixes this diagnostic
    action.diagnostics = [diagnostic];
    action.isPreferred = true;

    return action;
  }
}
