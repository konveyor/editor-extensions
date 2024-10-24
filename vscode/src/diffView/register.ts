import * as vscode from "vscode";
import { FileItem, KonveyorFileModel, KonveyorTreeDataProvider } from "./fileModel";
import { MemFS } from "./fileSystemProvider";
import { testLocations, testPaths, writeResponse } from "./mock";
import fs from "fs";
import path from "path";
import { Navigation } from "./navigation";

export function registerDiffView(context: vscode.ExtensionContext): void {
  const memFs = new MemFS();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("konveyorMemFs", memFs, {
      isCaseSensitive: true,
    }),
  );
  const changedFiles = Object.fromEntries(
    testPaths.map((fsPath) => [
      fsPath,
      fs.readFileSync(path.join(context.extensionPath, "src", "diffView", "resolutions", fsPath), {
        encoding: "utf8",
      }),
    ]),
  );
  writeResponse(changedFiles, memFs);
  const model = new KonveyorFileModel(testLocations);
  const provider = new KonveyorTreeDataProvider(model);
  vscode.window.registerTreeDataProvider("konveyor.diffView", provider);
  const treeView = vscode.window.createTreeView<unknown>("konveyor.diffView", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  new Navigation(treeView, model);

  treeView.message = model.message;
  context.subscriptions.push(treeView);

  provider.onDidChangeTreeData(() => {
    treeView.message = model.message;
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("konveyor.diffView.applyAll", applyAll),
    vscode.commands.registerCommand("konveyor.diffView.revertAll", revertAll),
    vscode.commands.registerCommand("konveyor.diffView.applyFile", applyFile),
    vscode.commands.registerCommand("konveyor.diffView.revertFile", revertFile),
    vscode.commands.registerCommand("konveyor.diffView.copyDiff", copyDiff),
    vscode.commands.registerCommand("konveyor.diffView.copyPath", copyPath),
  );
}

function applyAll() {
  vscode.window.showInformationMessage(`[TODO] Apply all resolutions`);
}

function revertAll() {
  vscode.window.showInformationMessage(`[TODO] Discard all local changes to resolutions`);
}

function applyFile(item: FileItem) {
  item.apply();
}

function revertFile(item: FileItem) {
  item.revert();
}
async function copyDiff(item: KonveyorFileModel | FileItem | unknown) {
  let val: string | undefined;
  if (item instanceof FileItem) {
    val = await item.asCopyText();
  }
  if (val) {
    await vscode.env.clipboard.writeText(val);
  }
}

async function copyPath(item: FileItem | unknown) {
  if (item instanceof FileItem) {
    if (item.uri.scheme === "file") {
      vscode.env.clipboard.writeText(item.uri.fsPath);
    } else {
      vscode.env.clipboard.writeText(item.uri.toString(true));
    }
  }
}
