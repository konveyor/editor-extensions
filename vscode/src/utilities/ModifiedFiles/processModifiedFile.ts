// processes a ModifiedFile message from agents
// 1. stores the state of the edit in a map to be reverted later
// 2. dependending on type of the file being modified:
//    a. For a build file, applies the edit directly to disk

import { KaiModifiedFile } from "@editor-extensions/agentic";
import { ModifiedFileState } from "@editor-extensions/shared";
import { Range, Uri, workspace, WorkspaceEdit } from "vscode";
import { getBuildFilesForLanguage } from "../fileUtils";
import { getConfigSuperAgentMode } from "../configuration";

//    b. For a non-build file, applies the edit to the file in-memory
export async function processModifiedFile(
  modifiedFilesState: Map<string, ModifiedFileState>,
  modifiedFile: KaiModifiedFile,
): Promise<void> {
  const { path, content } = modifiedFile;
  const uri = Uri.file(path);
  const editType = getBuildFilesForLanguage("java").some((f) => uri.fsPath.endsWith(f))
    ? "toDisk"
    : "inMemory";
  const alreadyModified = modifiedFilesState.has(uri.fsPath);
  // check if this is a newly created file
  let isNew = false;
  let originalContent: undefined | string = undefined;
  if (!alreadyModified) {
    try {
      await workspace.fs.stat(uri);
    } catch (err) {
      if ((err as any).code === "FileNotFound" || (err as any).name === "EntryNotFound") {
        isNew = true;
      } else {
        throw err;
      }
    }
    originalContent = isNew
      ? undefined
      : new TextDecoder().decode(await workspace.fs.readFile(uri));
    modifiedFilesState.set(uri.fsPath, {
      modifiedContent: content,
      originalContent,
      editType,
    });
  } else {
    modifiedFilesState.set(uri.fsPath, {
      ...(modifiedFilesState.get(uri.fsPath) as ModifiedFileState),
      modifiedContent: content,
    });
  }
  // if we are not running full agentic flow, we don't have to persist changes
  if (!getConfigSuperAgentMode()) {
    return;
  }
  if (editType === "toDisk") {
    await workspace.fs.writeFile(uri, new Uint8Array(Buffer.from(content)));
  } else {
    try {
      if (isNew && !alreadyModified) {
        await workspace.fs.writeFile(uri, new Uint8Array(Buffer.from("")));
      }
      // an in-memory edit is applied via the editor window
      const textDocument = await workspace.openTextDocument(uri);
      const range = new Range(
        textDocument.positionAt(0),
        textDocument.positionAt(textDocument.getText().length),
      );
      const edit = new WorkspaceEdit();
      edit.replace(uri, range, content);
      await workspace.applyEdit(edit);
    } catch (err) {
      console.log(`Failed to apply edit made by the agent - ${String(err)}`);
    }
  }
}
