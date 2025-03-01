import * as vscode from "vscode";
import { getConfigAnalyzeOnSave } from "../utilities";
import { ExtensionState } from "../extensionState";
import { isUriIgnored } from "../paths";

export const registerAnalysisTrigger = (disposables: vscode.Disposable[]) => {
  const changedDocuments = new Set<vscode.Uri>();

  vscode.workspace.onDidChangeTextDocument(
    (e: vscode.TextDocumentChangeEvent) => {
      if (e.contentChanges.length > 0) {
        changedDocuments.add(e.document.uri);
      }
    },
    undefined,
    disposables,
  );

  vscode.workspace.onDidCloseTextDocument(
    ({ uri }: vscode.TextDocument) => {
      changedDocuments.delete(uri);
    },
    undefined,
    disposables,
  );

  vscode.workspace.onDidSaveTextDocument(
    ({ uri }: vscode.TextDocument) => {
      if (changedDocuments.has(uri)) {
        changedDocuments.delete(uri);

        // Any restrictions on if the document at `uri` should be
        // sent through partial analysis should be done here.
        if (!isUriIgnored(uri)) {
          vscode.commands.executeCommand("konveyor.partialAnalysis", [uri]);
        }
      }
    },
    undefined,
    disposables,
  );
};

export const runPartialAnalysis = async (state: ExtensionState, filePaths: vscode.Uri[]) => {
  if (!getConfigAnalyzeOnSave()) {
    return;
  }

  const analyzerClient = state.analyzerClient;
  if (!analyzerClient || !analyzerClient.canAnalyze()) {
    vscode.window.showErrorMessage("Analyzer must be started and configured before run!");
    return;
  }
  analyzerClient.runAnalysis(filePaths);
};
