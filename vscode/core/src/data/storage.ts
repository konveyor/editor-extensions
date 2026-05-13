import * as vscode from "vscode";
import fs from "fs";

import { RuleSet } from "@editor-extensions/shared";
import {
  isAnalysis,
  MERGED_RULE_SET_DATA_FILE_PREFIX,
  RULE_SET_DATA_FILE_PREFIX,
  SOLUTION_DATA_FILE_PREFIX,
} from "../utilities";
import { paths } from "../paths";
import { Immutable } from "immer";

const MAX_FILES = 5;

const getDataFilesByPrefix = async (prefix: string) => {
  const dataFolderPath = paths().data;
  if (!dataFolderPath) {
    return [];
  }
  const files = await vscode.workspace.fs.readDirectory(dataFolderPath);
  return files
    .filter(([name]) => name.startsWith(prefix))
    .sort(([nameA], [nameB]) => nameA.localeCompare(nameB));
};

const deleteOldestDataFiles = async (prefix: string, maxCount: number) => {
  const files = await getDataFilesByPrefix(prefix);

  const dataFolderPath = paths().data;
  if (!dataFolderPath) {
    return;
  }

  const delCount = files.length - maxCount;
  for (let i = 0; i < delCount; i++) {
    const [name] = files[i];
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(dataFolderPath, name));
  }
};

export const deleteAllDataFilesByPrefix = async (prefix: string) => {
  const files = await getDataFilesByPrefix(prefix);

  const dataFolderPath = paths().data;
  if (!dataFolderPath) {
    return;
  }

  for (const [name] of files) {
    await vscode.workspace.fs.delete(vscode.Uri.joinPath(dataFolderPath, name));
  }
};

export async function writeDataFile(
  content: Immutable<RuleSet[]>,
  prefix: string,
  format: "json" = "json",
) {
  const dataFolderPath = paths().data;
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
    vscode.Uri.joinPath(dataFolderPath, `${prefix}_${dateString}.${format}`),
    Buffer.from(JSON.stringify(content, undefined, 2)),
  );

  deleteOldestDataFiles(prefix, MAX_FILES);
}

export const loadStateFromDataFolder = async (): Promise<RuleSet[] | undefined> => {
  const dataFolder = paths().data;
  if (!dataFolder) {
    return undefined;
  }

  const [fullAnalysisFiles, mergedAnalysisFiles, solutionFiles] = await Promise.all([
    getDataFilesByPrefix(RULE_SET_DATA_FILE_PREFIX),
    getDataFilesByPrefix(MERGED_RULE_SET_DATA_FILE_PREFIX),
    getDataFilesByPrefix(SOLUTION_DATA_FILE_PREFIX),
  ]);

  const [newestFullAnalysis] = fullAnalysisFiles.reverse();
  const [newestMergedAnalysis] = mergedAnalysisFiles.reverse();
  const newestAnalysis = newestMergedAnalysis || newestFullAnalysis;
  const uris = newestAnalysis ? [vscode.Uri.joinPath(dataFolder, newestAnalysis[0])] : [];
  return readDataFiles(uris);
};

export const readDataFiles = async (uris: vscode.Uri[]): Promise<RuleSet[] | undefined> => {
  let analysisResults = undefined;
  for (const uri of uris) {
    if (!uri || analysisResults) {
      break;
    }
    const fileContent = await fs.promises.readFile(uri.fsPath, { encoding: "utf8" });
    const parsed = JSON.parse(fileContent);
    analysisResults =
      !analysisResults && Array.isArray(parsed) && parsed.every((item) => isAnalysis(item))
        ? parsed
        : analysisResults;
  }
  return analysisResults;
};
