import * as vscode from "vscode";
import { ExtensionState } from "src/extensionState";
import { fromRelativeToKonveyor, KONVEYOR_READ_ONLY_SCHEME } from "../utilities";
import { FileItem, toUri } from "./fileModel";
import { LocalChange } from "@editor-extensions/shared";
import { Immutable } from "immer";
import { getConfigDiffEditorType } from "../utilities";

export const applyAll = async (state: ExtensionState) => {
  const localChanges = state.data.localChanges;

  state.mutateData((draft) => {
    draft.localChanges = localChanges.map((it) => ({ ...it, state: "applied" }));
  });

  vscode.window.showInformationMessage(`All resolutions applied successfully`);
};

export const discardAll = async (state: ExtensionState) => {
  const localChanges = state.data.localChanges;

  state.mutateData((draft) => {
    draft.localChanges = localChanges.map((it) => ({ ...it, state: "discarded" }));
  });

  vscode.window.showInformationMessage(`Discarded all resolutions`);
};

export const viewFix = async (uri: vscode.Uri, preserveFocus: boolean) =>
  getConfigDiffEditorType() === "merge"
    ? viewFixInMergeEditor(uri, preserveFocus)
    : viewFixInDiffEditor(uri, preserveFocus);

export const viewFixInMergeEditor = async (uri: vscode.Uri, preserveFocus: boolean = false) => {
  const readOnlyUri = vscode.Uri.from({ ...uri, scheme: KONVEYOR_READ_ONLY_SCHEME });
  const options = {
    base: readOnlyUri,
    input1: { uri: readOnlyUri, title: "Current" },
    input2: {
      uri: fromRelativeToKonveyor(vscode.workspace.asRelativePath(uri)),
      title: "Suggested",
    },
    output: uri,
    options: { preserveFocus },
  };

  await vscode.commands.executeCommand("_open.mergeEditor", options);
};

export const viewFixInDiffEditor = async (uri: vscode.Uri, preserveFocus: boolean = false) =>
  vscode.commands.executeCommand(
    "vscode.diff",
    uri,
    fromRelativeToKonveyor(vscode.workspace.asRelativePath(uri)),
    "Current ↔ Suggested",
    {
      preserveFocus,
    },
  );

export const applyFile = async (item: FileItem | vscode.Uri | unknown, state: ExtensionState) => {
  const index = getChangeIndex(item, "Failed to apply changes", state.data.localChanges);
  if (index > -1) {
    state.mutateData((draft) => {
      draft.localChanges[index].state = "applied";
    });
  }
};

interface ApplyBlockArgs {
  mapping: { original: vscode.Range; innerChanges: unknown };
  modifiedUri: vscode.Uri;
  originalUri: vscode.Uri;
  originalWithModifiedChanges: string;
}

export const applyBlock = async ({ originalUri, originalWithModifiedChanges }: ApplyBlockArgs) => {
  const doc = vscode.workspace.textDocuments.find(
    (doc) => doc.uri.toString() === originalUri.toString(),
  );

  if (!doc) {
    vscode.window.showErrorMessage(`Failed to retrieve editor for ${originalUri}`);
    console.error(`Failed to retrieve editor for ${originalUri}`);
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(originalUri, new vscode.Range(0, 0, doc.lineCount, 0), originalWithModifiedChanges);

  // note that left side edits will open a duplicated editor
  // bug opened: https://github.com/microsoft/vscode/issues/234097
  return vscode.workspace.applyEdit(edit);
};

export const discardFile = async (item: FileItem | vscode.Uri | unknown, state: ExtensionState) => {
  const index = getChangeIndex(item, "Failed to discard changes", state.data.localChanges);
  if (index > -1) {
    state.mutateData((draft) => {
      draft.localChanges[index].state = "discarded";
    });
  }
};

const getChangeIndex = (
  item: FileItem | vscode.Uri | unknown,
  errorMsg: string,
  localChanges: Immutable<LocalChange[]>,
) => {
  const originalUri = toUri(item);
  if (!originalUri) {
    vscode.window.showErrorMessage(`${errorMsg}(unknown URI)`);
    console.error(`${errorMsg}(unknown URI)`, item, originalUri);
    return -1;
  }
  const index = localChanges.findIndex(
    (it) => it.originalUri.toString() === originalUri.toString(),
  );

  if (index < 0) {
    vscode.window.showErrorMessage(`${errorMsg}(unknown index)`);
    console.error(`${errorMsg}(unknown index)`, item, originalUri);
    return -1;
  }
  return index;
};
