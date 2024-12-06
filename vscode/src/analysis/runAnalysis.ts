import { getConfigAnalyzeOnSave } from "../utilities";
import { ExtensionState } from "../extensionState";
import { TextDocument, commands, window } from "vscode";

export const partialAnalysisTrigger = (textDoc: TextDocument) => {
  commands.executeCommand("konveyor.partialAnalysis", [textDoc.fileName]);
};

export const runPartialAnalysis = async (state: ExtensionState, filePaths: string[]) => {
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
