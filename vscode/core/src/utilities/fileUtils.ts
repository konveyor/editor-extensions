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

export interface ExecutableCheckResult {
  isExecutable: boolean;
  error?: {
    type: "not-found" | "not-executable" | "invalid-extension" | "unknown";
    message: string;
    suggestion: string;
  };
}

export const checkIfExecutable = async (filePath: string): Promise<ExecutableCheckResult> => {
  try {
    // Normalize the path for cross-platform compatibility
    const normalizedPath = path.normalize(filePath);

    // First check if file exists
    try {
      await access(normalizedPath, fs.constants.F_OK);
    } catch {
      return {
        isExecutable: false,
        error: {
          type: "not-found",
          message: `File not found: ${normalizedPath}`,
          suggestion: "Verify the file path is correct and the file exists.",
        },
      };
    }

    if (isWindows) {
      // On Windows, check if the file has a valid executable extension
      const executableExtensions = [".exe"];
      const fileExtension = path.extname(normalizedPath).toLowerCase();

      if (!executableExtensions.includes(fileExtension)) {
        return {
          isExecutable: false,
          error: {
            type: "invalid-extension",
            message: `File must have .exe extension on Windows: ${normalizedPath}`,
            suggestion: "Select a Windows executable file (.exe).",
          },
        };
      }
    } else {
      // On Unix systems, check for execute permissions
      try {
        await access(normalizedPath, fs.constants.X_OK);
      } catch {
        return {
          isExecutable: false,
          error: {
            type: "not-executable",
            message: `File exists but does not have execute permissions: ${normalizedPath}`,
            suggestion: `Verify the file has execute permissions.`,
          },
        };
      }
    }

    return { isExecutable: true };
  } catch (err) {
    console.error("Error checking if file is executable:", err);
    return {
      isExecutable: false,
      error: {
        type: "unknown",
        message: `Unable to validate file: ${err}`,
        suggestion: "Verify the file path and permissions.",
      },
    };
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
