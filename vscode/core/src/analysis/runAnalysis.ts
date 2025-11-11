import * as vscode from "vscode";
import { ALL_REVISIONS } from "@editor-extensions/agentic";

import { getConfigAnalyzeOnSave, getConfigAgentMode } from "../utilities";
import { ExtensionState } from "../extensionState";
import { BatchedAnalysisTrigger } from "./batchedAnalysisTrigger";

export const registerAnalysisTrigger = (
  disposables: vscode.Disposable[],
  state: ExtensionState,
) => {
  const batchedAnalysisTrigger = new BatchedAnalysisTrigger(state);
  state.batchedAnalysisTrigger = batchedAnalysisTrigger;

  vscode.workspace.onDidRenameFiles(
    async (e: vscode.FileRenameEvent) => {
      for (const { oldUri } of e.files) {
        await state.kaiFsCache.invalidate(oldUri.fsPath);
      }
    },
    undefined,
    disposables,
  );

  vscode.workspace.onDidCloseTextDocument((_: vscode.TextDocument) => {}, undefined, disposables);

  vscode.workspace.onDidSaveTextDocument(
    async (d: vscode.TextDocument) => {
      if (!getConfigAnalyzeOnSave() && !getConfigAgentMode()) {
        return;
      }

      await state.kaiFsCache.invalidate(d.uri.fsPath, { maxRevisions: ALL_REVISIONS });
      batchedAnalysisTrigger.notifyFileChanges({
        path: d.uri,
        content: d.getText(),
        saved: true,
      });
    },
    undefined,
    disposables,
  );

  // Add disposal of batchedAnalysisTrigger
  disposables.push({
    dispose: () => {
      batchedAnalysisTrigger.dispose();
      state.batchedAnalysisTrigger = undefined;
    },
  });
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
  return analyzerClient.runAnalysis(filePaths);
};
