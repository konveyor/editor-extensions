import * as vscode from "vscode";
import { RuleSet } from "@editor-extensions/shared";
import { loadStateFromDataFolder, readDataFiles } from "./storage";
import { paths } from "../paths";
import { executeExtensionCommand } from "../commands";

export const loadStaticResults = async () => {
  const options: vscode.OpenDialogOptions = {
    defaultUri: paths().workspaceRepo,
    openLabel: "Load Konveyor results",
    filters: { "json files": ["json"] },
    canSelectMany: true,
  };
  const uris = await vscode.window.showOpenDialog(options);

  if (!uris?.length) {
    vscode.window.showErrorMessage("No files selected");
    return;
  }

  const [analysisResults, solution] = await readDataFiles(uris);

  if (!analysisResults && !solution) {
    vscode.window.showErrorMessage("Konveyor: failed to load data from selected file(s).");
    return;
  }

  if (analysisResults) {
    if (filePathsCorrect(analysisResults)) {
      executeExtensionCommand("loadRuleSets", analysisResults);
      vscode.window.showInformationMessage("Successfully loaded the analysis results");
    } else {
      vscode.window.showErrorMessage("Konveyor: analysis results point to non-existing files.");
    }
  }
};

//TODO: as for now analysis results are based on absolute paths which need to be manually adjusted
// run a check if the analyzed files in the workspace
const filePathsCorrect = (ruleSets: RuleSet[]) =>
  ruleSets
    .flatMap((ruleSet) => Object.values(ruleSet.violations ?? {}))
    .flatMap((violation) => violation.incidents)
    .every(
      (incident) =>
        !incident.uri || vscode.workspace.getWorkspaceFolder(vscode.Uri.parse(incident.uri)),
    );

export const loadResultsFromDataFolder = async () => {
  const [analysisResults] = await loadStateFromDataFolder();
  if (analysisResults) {
    executeExtensionCommand("loadRuleSets", analysisResults);
  }
};
