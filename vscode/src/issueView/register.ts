import { ExtensionState } from "src/extensionState";
import * as vscode from "vscode";
import { FileItem, IncidentTypeItem, IssuesTreeDataProvider, ReferenceItem } from "./issueModel";
import { Immutable } from "immer";
import { ExtensionData, RuleSet } from "@editor-extensions/shared";
import { expandAll, expandChildren } from "./expandCommands";

export function registerIssueView({
  extensionContext: context,
  issueModel: model,
}: ExtensionState): (data: Immutable<ExtensionData>) => void {
  const provider = new IssuesTreeDataProvider(model);
  vscode.window.registerTreeDataProvider("konveyor.issueView", provider);
  const treeView = vscode.window.createTreeView<IncidentTypeItem | FileItem | ReferenceItem>(
    "konveyor.issueView",
    {
      treeDataProvider: provider,
      showCollapseAll: true,
    },
  );

  treeView.message = model.message;
  treeView.badge = model.badge;
  context.subscriptions.push(treeView);
  provider.onDidChangeTreeData(() => {
    treeView.message = model.message;
    treeView.badge = model.badge;
  });
  // auto-expand nodes with only one child
  treeView.onDidExpandElement((event) => {
    const element = event.element;
    if (element.hasOneChild()) {
      treeView.reveal(element, { select: false, focus: false, expand: 2 });
    }
  });

  vscode.commands.registerCommand("konveyor.expandAllIssues", () => expandAll(model, treeView));
  vscode.commands.registerCommand(
    "konveyor.expandSingleIssue",
    (item: IncidentTypeItem | FileItem | ReferenceItem) => expandChildren(item, treeView),
  );

  let firstLoad = true;
  let lastRuleSets: Immutable<RuleSet[]> = [];
  return (data: Immutable<ExtensionData>) => {
    // by-reference comparison assumes immutable state object
    if (lastRuleSets !== data.ruleSets) {
      model.updateIssues(data.ruleSets);
      lastRuleSets = data.ruleSets;
    }

    if (firstLoad) {
      firstLoad = false;
      // TODO: re-implement to be explicitly part of the extension lifecycle
      // current code relies on the side effects
      vscode.commands.executeCommand("konveyor.showAnalysisPanel");
    }
  };
}
