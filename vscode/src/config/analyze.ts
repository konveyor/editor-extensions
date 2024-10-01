import * as vscode from "vscode";

export async function canAnalyze(): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("konveyor");
  const labelSelector = config.get("labelSelector") as string;
  const useDefaultRulesets = config.get("useDefaultRulesets") as boolean;
  const customRules = config.get("customRules") as string[];

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

  if (!useDefaultRulesets && (!customRules || customRules.length === 0)) {
    const selection = await vscode.window.showWarningMessage(
      "Default rulesets are disabled and no custom rules are defined. Please choose an option to proceed.",
      "Enable Default Rulesets",
      "Configure Custom Rules",
      "Cancel",
    );

    switch (selection) {
      case "Enable Default Rulesets":
        await config.update("useDefaultRulesets", true, vscode.ConfigurationTarget.Workspace);
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
