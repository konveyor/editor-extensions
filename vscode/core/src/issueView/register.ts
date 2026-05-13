import { ExtensionState } from "src/extensionState";
import * as vscode from "vscode";
import { FileItem, IncidentTypeItem, IssuesTreeDataProvider, ReferenceItem } from "./issueModel";
import { Immutable } from "immer";
import { ExtensionData, RuleSet } from "@editor-extensions/shared";
import { expandAll, expandChildren } from "./expandCommands";
import { EXTENSION_NAME } from "../utilities/constants";

export function registerIssueView({
  extensionContext: context,
  issueModel: model,
}: ExtensionState): (data: Immutable<ExtensionData>) => void {
  const provider = new IssuesTreeDataProvider(model);
  vscode.window.registerTreeDataProvider(`${EXTENSION_NAME}.issueView`, provider);
  const treeView = vscode.window.createTreeView<IncidentTypeItem | FileItem | ReferenceItem>(
    `${EXTENSION_NAME}.issueView`,
    {
      treeDataProvider: provider,
      showCollapseAll: true,
    },
  );

  treeView.message = model.message ?? undefined;
  treeView.badge = model.badge;
  context.subscriptions.push(treeView);
  provider.onDidChangeTreeData(() => {
    treeView.message = model.message ?? undefined;
    treeView.badge = model.badge;
  });
  // auto-expand nodes with only one child
  treeView.onDidExpandElement((event) => {
    const element = event.element;
    if (element.hasOneChild()) {
      treeView.reveal(element, { select: false, focus: false, expand: 2 });
    }
  });

  vscode.commands.registerCommand(`${EXTENSION_NAME}.expandAllIssues`, () =>
    expandAll(model, treeView),
  );
  vscode.commands.registerCommand(
    `${EXTENSION_NAME}.expandSingleIssue`,
    (item: IncidentTypeItem | FileItem | ReferenceItem) => expandChildren(item, treeView),
  );

  let lastRuleSets: Immutable<RuleSet[]> = [];
  let lastEnhancedIncidents: Immutable<ExtensionData["enhancedIncidents"]> = [];
  return (data: Immutable<ExtensionData>) => {
    // by-reference comparison assumes immutable state object
    if (lastRuleSets !== data.ruleSets || lastEnhancedIncidents !== data.enhancedIncidents) {
      model.updateIssues(data.ruleSets, data.enhancedIncidents);
      lastRuleSets = data.ruleSets;
      lastEnhancedIncidents = data.enhancedIncidents;
      const hasIssues = model.countIncidents() > 0;
      vscode.commands.executeCommand("setContext", `${EXTENSION_NAME}.hasIssues`, hasIssues);
    }
  };
}
