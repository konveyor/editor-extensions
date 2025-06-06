import path from "path";
import fs from "fs";
import { access } from "node:fs/promises";
import { platform } from "node:process";
import * as vscode from "vscode";
import { paths } from "../paths";

const isWindows = platform === "win32";

// TODO (pgaikwad) - ideally, programming language should come from analysis profiles instead
// this is a list of files for the workspace which are saved when modified by the agent to refresh diagnostics
export const getBuildFilesForLanguage = (programmingLanguage: string): Array<string> => {
  switch (programmingLanguage.toLowerCase()) {
    case "java":
      return ["pom.xml", "build.gradle"];
    case "go":
      return ["go.mod"];
    case "ts":
      return ["package.json"];
    default:
      return [];
  }
};

export const checkIfExecutable = async (filePath: string): Promise<boolean> => {
  try {
    // Normalize the path for cross-platform compatibility
    const normalizedPath = path.normalize(filePath);

    if (isWindows) {
      // On Windows, check if the file has a valid executable extension
      const executableExtensions = [".exe"];
      const fileExtension = path.extname(normalizedPath).toLowerCase();

      if (!executableExtensions.includes(fileExtension)) {
        console.warn(`File does not have a valid Windows executable extension: ${normalizedPath}`);
        return false;
      }
    } else {
      // On Unix systems, check for execute permissions
      await access(normalizedPath, fs.constants.X_OK);
    }

    // Check if the file exists
    await access(normalizedPath, fs.constants.F_OK);
    return true;
  } catch (err) {
    console.error("Error checking if file is executable:", err);
    return false;
  }
};

/**
 * Copy in the sample provider settings file if the settings file doesn't exist. If
 * forced, backup the existing file first.
 */
export const copySampleProviderSettings = async (force: boolean = false) => {
  let needCopy = force;
  let backupUri;
  try {
    await vscode.workspace.fs.stat(paths().settingsYaml);
    if (force) {
      const { name, ext } = path.parse(paths().settingsYaml.fsPath);
      const [date, time] = new Date().toISOString().split("T");
      const backupName = `${name}.${date}_${time.replaceAll(":", "-").split(".")[0]}${ext}`;
      backupUri = vscode.Uri.joinPath(paths().settingsYaml, "..", backupName);
    }
  } catch {
    needCopy = true;
  }

  if (backupUri && needCopy) {
    await vscode.workspace.fs.rename(paths().settingsYaml, backupUri);
  }

  if (needCopy) {
    await vscode.workspace.fs.copy(
      vscode.Uri.joinPath(paths().extResources, "sample-provider-settings.yaml"),
      paths().settingsYaml,
      { overwrite: true },
    );
  }
};
