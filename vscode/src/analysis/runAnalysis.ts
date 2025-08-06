import * as vscode from "vscode";
import { getConfigAnalyzeOnSave, getConfigAgentMode } from "../utilities";
import { ExtensionState } from "../extensionState";
import { BatchedAnalysisTrigger } from "./batchedAnalysisTrigger";

export const registerAnalysisTrigger = (
  disposables: vscode.Disposable[],
  state: ExtensionState,
) => {
  const batchedAnalysisTrigger = new BatchedAnalysisTrigger(state);

  vscode.workspace.onDidRenameFiles(
    async (e: vscode.FileRenameEvent) => {
      for (const { oldUri } of e.files) {
        await state.kaiFsCache.invalidate(oldUri.fsPath);
      }
    },
    undefined,
    disposables,
  );

  vscode.workspace.onDidCloseTextDocument(
    ({ uri }: vscode.TextDocument) => {},
    undefined,
    disposables,
  );

  vscode.workspace.onDidSaveTextDocument(
    async (d: vscode.TextDocument) => {
      if (!getConfigAnalyzeOnSave() && !getConfigAgentMode()) {
        return;
      }

      await state.kaiFsCache.invalidate(d.uri.fsPath);
      batchedAnalysisTrigger.notifyFileChanges({
        path: d.uri,
        content: d.getText(),
        saved: true,
      });
    },
    undefined,
    disposables,
  );
};

export const runPartialAnalysis = async (state: ExtensionState, filePaths: vscode.Uri[]) => {
  if (!getConfigAnalyzeOnSave() && !getConfigAgentMode()) {
    return;
  }

  const analyzerClient = state.analyzerClient;
  if (!analyzerClient || !analyzerClient.canAnalyze()) {
    vscode.window.showErrorMessage("Analyzer must be started and configured before run!");
    return;
  }
  analyzerClient.runAnalysis(filePaths);
};
