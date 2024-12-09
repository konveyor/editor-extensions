import { ExtensionState } from "src/extensionState";
import * as vscode from "vscode";
import { IssuesTreeDataProvider } from "./issueModel";
import { Immutable } from "immer";
import { ExtensionData, RuleSet } from "@editor-extensions/shared";

export function registerIssueView({
  extensionContext: context,
  issueModel: model,
}: ExtensionState): (data: Immutable<ExtensionData>) => void {
  const provider = new IssuesTreeDataProvider(model);
  vscode.window.registerTreeDataProvider("konveyor.issueView", provider);
  const treeView = vscode.window.createTreeView<unknown>("konveyor.issueView", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  treeView.message = model.message;
  context.subscriptions.push(treeView);

  provider.onDidChangeTreeData(() => {
    treeView.message = model.message;
  });

  let lastRuleSets: Immutable<RuleSet[]> = [];
  return (data: Immutable<ExtensionData>) => {
    // by-reference comparison assumes immutable state object
    if (lastRuleSets !== data.ruleSets) {
      model.updateIssues(data.ruleSets);
      lastRuleSets = data.ruleSets;
    }
  };
}
