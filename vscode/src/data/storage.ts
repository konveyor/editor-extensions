import path from "path";
import * as vscode from "vscode";
import fs from "fs";

import { RuleSet, GetSolutionResult } from "@editor-extensions/shared";
import {
  isAnalysis,
  isSolution,
  RULE_SET_DATA_FILE_PREFIX,
  SOLUTION_DATA_FILE_PREFIX,
} from "../utilities";

const MAX_FILES = 5;

const buildDataFolderPath = () => {
  const firstWorkspace = vscode.workspace.workspaceFolders?.[0];
  if (!firstWorkspace) {
    return;
  }

  return path.join(firstWorkspace.uri.fsPath, ".vscode", "konveyor");
};

const getDataFolder = () => {
  const dataFolderPath = buildDataFolderPath();
  return dataFolderPath && fs.existsSync(dataFolderPath) ? dataFolderPath : undefined;
};

const createDataFolderIfNeeded = async () => {
  if (getDataFolder()) {
    return;
  }
  const dataFolderPath = buildDataFolderPath();
  if (dataFolderPath) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dataFolderPath));
  } else {
    console.log("Cannot create data folder due to no workspace");
  }
};

const getDataFilesByPrefix = async (prefix: string) => {
  const dataFolderPath = getDataFolder();
  if (!dataFolderPath) {
    return [];
  }
  const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dataFolderPath));
  return files
    .filter(([name]) => name.startsWith(prefix))
    .sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
};

const deleteOldestDataFiles = async (prefix: string, maxCount: number) => {
  const files = await getDataFilesByPrefix(prefix);

  const dataFolderPath = getDataFolder();
  if (!dataFolderPath) {
    return;
  }

  const delCount = files.length - maxCount;
  for (let i = 0; i < delCount; i++) {
    const [name] = files[i];
    await vscode.workspace.fs.delete(vscode.Uri.file(path.join(dataFolderPath, name)));
  }
};

export async function writeDataFile(
  content: RuleSet[] | GetSolutionResult,
  prefix: string,
  format: "json" = "json",
) {
  await createDataFolderIfNeeded();

  const dataFolderPath = getDataFolder();
  if (!dataFolderPath) {
    return;
  }

  const dateString = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replaceAll("-", "")
    .substring(0, 15);
  // i.e .vscode/konveyor/analysis_20241105T124657.json
  await vscode.workspace.fs.writeFile(
    vscode.Uri.file(path.join(dataFolderPath, `${prefix}_${dateString}.${format}`)),
    Buffer.from(JSON.stringify(content, undefined, 2)),
  );

  deleteOldestDataFiles(prefix, MAX_FILES);
}

export const loadStateFromDataFolder = async (): Promise<
  [RuleSet[] | undefined, GetSolutionResult | undefined]
> => {
  const dataFolder = getDataFolder();
  if (!dataFolder) {
    return [undefined, undefined];
  }

  const [analysisFiles, solutionFiles] = await Promise.all([
    getDataFilesByPrefix(RULE_SET_DATA_FILE_PREFIX),
    getDataFilesByPrefix(SOLUTION_DATA_FILE_PREFIX),
  ]);

  const [newestAnalysis] = analysisFiles.reverse();
  const [newestSolution] = solutionFiles.reverse();
  const uris = [newestAnalysis, newestSolution]
    .filter(Boolean)
    .map(([name]) => vscode.Uri.file(path.join(dataFolder, name)));
  return readDataFiles(uris);
};

export const readDataFiles = async (
  uris: vscode.Uri[],
): Promise<[RuleSet[] | undefined, GetSolutionResult | undefined]> => {
  let analysisResults = undefined;
  let solution = undefined;
  for (const uri of uris) {
    if (!uri || (analysisResults && solution)) {
      break;
    }
    const fileContent = await fs.promises.readFile(uri.fsPath, { encoding: "utf8" });
    const parsed = JSON.parse(fileContent);
    solution = !solution && isSolution(parsed) ? parsed : solution;
    analysisResults =
      !analysisResults && Array.isArray(parsed) && parsed.every((item) => isAnalysis(item))
        ? parsed
        : analysisResults;
  }
  return [analysisResults, solution];
};
