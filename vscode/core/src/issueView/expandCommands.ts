import { TreeView } from "vscode";
import { IncidentTypeItem, IssuesModel, ReferenceItem, FileItem } from "./issueModel";

export const expandAll = async (
  model: IssuesModel,
  treeView: TreeView<IncidentTypeItem | FileItem | ReferenceItem>,
) => {
  for (const item of model.items.reverse()) {
    await treeView.reveal(item, { select: false, focus: false, expand: 2 });
  }
};

export const expandChildren = (
  item: IncidentTypeItem | FileItem | ReferenceItem,
  treeView: TreeView<IncidentTypeItem | FileItem | ReferenceItem>,
) => {
  treeView.reveal(item, { select: false, focus: false, expand: 2 });
};
