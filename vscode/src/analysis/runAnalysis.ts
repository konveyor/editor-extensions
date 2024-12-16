import { getConfigAnalyzeOnSave } from "../utilities";
import { ExtensionState } from "../extensionState";
import { TextDocument, Uri, commands, window } from "vscode";

export const partialAnalysisTrigger = (textDoc: TextDocument) => {
  if (textDoc.uri.scheme === "file") {
    commands.executeCommand("konveyor.partialAnalysis", [textDoc.uri]);
  }
};

export const runPartialAnalysis = async (state: ExtensionState, filePaths: Uri[]) => {
  if (!getConfigAnalyzeOnSave()) {
    return;
  }

  const analyzerClient = state.analyzerClient;
  if (!analyzerClient || !analyzerClient.canAnalyze()) {
    window.showErrorMessage("Analyzer must be started and configured before run!");
    return;
  }
  analyzerClient.runAnalysis(filePaths);
};
