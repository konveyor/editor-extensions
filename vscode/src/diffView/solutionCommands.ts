import * as vscode from "vscode";
import { ExtensionState } from "src/extensionState";
import { fromRelativeToKonveyor } from "../utilities";
import { writeSolutionsToMemFs } from "../data/virtualStorage";
import { FileItem, toUri } from "./fileModel";

export const applyAll = async (state: ExtensionState) => {
  const localChanges = state.localChanges;
  await Promise.all(
    localChanges.map(({ originalUri, modifiedUri }) =>
      vscode.workspace.fs.copy(modifiedUri, originalUri, { overwrite: true }),
    ),
  );
  const sidebarProvider = state.webviewProviders?.get("sidebar");
  sidebarProvider?.webview?.postMessage({
    type: "solutionConfirmation",
    data: { confirmed: true, solution: null },
  });
  //TODO: need to keep solutions view and analysis view in sync based on these actions
  vscode.window.showInformationMessage(`All resolutions applied successfully`);
  state.fileModel.updateLocations([]);
};

export const revertAll = async (state: ExtensionState) => {
  const localChanges = state.localChanges;
  await writeSolutionsToMemFs(localChanges, state);
  vscode.window.showInformationMessage(`Discarded all local changes to the resolutions`);
};

export const viewFix = (uri: vscode.Uri, preserveFocus: boolean = false) =>
  vscode.commands.executeCommand(
    "vscode.diff",
    uri,
    fromRelativeToKonveyor(vscode.workspace.asRelativePath(uri)),
    "Current file <-> Suggested changes",
    {
      preserveFocus,
    },
  );

export const applyFile = async (item: FileItem | vscode.Uri | unknown, state: ExtensionState) => {
  const originalUri = toUri(item);
  if (!originalUri) {
    vscode.window.showErrorMessage("Failed to apply changes");
    console.error("Failed to apply changes", item, originalUri);
    return;
  }
  const modifiedUri = fromRelativeToKonveyor(vscode.workspace.asRelativePath(originalUri));
  await vscode.workspace.fs.copy(modifiedUri, originalUri, { overwrite: true });
  state.fileModel.markedAsApplied(originalUri);
};

export const revertFile = async (item: FileItem | vscode.Uri | unknown, state: ExtensionState) => {
  const originalUri = toUri(item);
  if (!originalUri) {
    vscode.window.showErrorMessage("Failed to discard changes");
    console.error("Failed to apply changes", item, originalUri);
    return;
  }
  const localChanges = state.localChanges;
  const change = localChanges.filter(
    (change) => change.originalUri.toString() === originalUri.toString(),
  );
  await writeSolutionsToMemFs(change, state);
};
