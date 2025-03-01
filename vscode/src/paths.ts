import { relative, dirname, posix } from "node:path";
import { readFileSync } from "node:fs";
import { globbySync, isIgnoredByIgnoreFilesSync } from "globby";
import * as vscode from "vscode";
import slash from "slash";

export interface ExtensionPaths {
  /** Directory with the extension's sample resources. */
  extResources: vscode.Uri;

  /** Workspace repository root. */
  workspaceRepo: vscode.Uri;

  /** Directory for analysis and resolution data files. */
  data: vscode.Uri;

  /** Directory for the extension's settings files. */
  settings: vscode.Uri;

  /** Direct path to the extension's provider settings yaml file. */
  settingsYaml: vscode.Uri;

  /** Directory to use as the working directory for the jsonrpc server. */
  serverCwd: vscode.Uri;

  /** Directory for jsonrpc server logs. */
  serverLogs: vscode.Uri;
}

export type ExtensionFsPaths = Record<keyof ExtensionPaths, string>;

async function ensureDirectory(uri: vscode.Uri, ...parts: string[]): Promise<vscode.Uri> {
  const joined = vscode.Uri.joinPath(uri, ...parts);

  let needsCreate = true;
  try {
    const stat = await vscode.workspace.fs.stat(joined);
    if (stat.type & vscode.FileType.Directory) {
      needsCreate = false;
    }
  } catch {
    needsCreate = true;
  }

  if (needsCreate) {
    await vscode.workspace.fs.createDirectory(joined);
  }
  return joined;
}

export async function ensurePaths(context: vscode.ExtensionContext): Promise<ExtensionPaths> {
  const firstWorkspace = vscode.workspace.workspaceFolders?.[0];
  if (!firstWorkspace) {
    throw new Error("An open workspace is required");
  }

  const globalScope = context.globalStorageUri;
  const workspaceScope = context.storageUri!;
  const workspaceRepoScope = vscode.Uri.joinPath(firstWorkspace.uri, ".vscode");
  const extResources = vscode.Uri.joinPath(context.extensionUri, "resources");
  const settingsYaml = vscode.Uri.joinPath(globalScope, "settings", "provider-settings.yaml");

  _paths = {
    extResources,
    workspaceRepo: firstWorkspace.uri,
    data: await ensureDirectory(workspaceRepoScope, "konveyor"),
    settings: await ensureDirectory(globalScope, "settings"),
    settingsYaml,
    serverCwd: await ensureDirectory(workspaceScope, "kai-rpc-server"),
    serverLogs: await ensureDirectory(workspaceRepoScope, "konveyor-logs"),
  };

  _fsPaths = {} as ExtensionFsPaths;
  for (const key of Object.keys(_paths) as Array<keyof ExtensionPaths>) {
    _fsPaths[key] = _paths[key].fsPath;
  }

  return _paths;
}

let _paths: ExtensionPaths | undefined = undefined;
let _fsPaths: Record<keyof ExtensionPaths, string> | undefined = undefined;

export function paths(): ExtensionPaths {
  if (_paths === undefined) {
    throw new Error("The extension has not been activated yet.");
  }
  return _paths;
}

export function fsPaths(): ExtensionFsPaths {
  if (_fsPaths === undefined) {
    throw new Error("The extension has not been activated yet.");
  }
  return _fsPaths;
}

const DEFAULT_IGNORES = [".git", ".vscode", "target", "node_modules"];
const IGNORE_FILE_IN_PRIORITY_ORDER = [".konveyorignore", ".gitignore"];

let _ignoreByFunction: undefined | ((path: string) => boolean);

/**
 * Find and use the right ignore settings to be able to ignore changes to a path.
 */
function isIgnoredBy(path: string): boolean {
  if (!_ignoreByFunction) {
    // Check for ignore files
    for (const glob of IGNORE_FILE_IN_PRIORITY_ORDER) {
      const ignoreFiles = globbySync(glob, { cwd: fsPaths().workspaceRepo });
      if (ignoreFiles.length > 0) {
        _ignoreByFunction = isIgnoredByIgnoreFilesSync(glob, {
          cwd: fsPaths().workspaceRepo,
        });
        break;
      }
    }

    // If no ignore files, use the default ignore patterns
    if (!_ignoreByFunction) {
      _ignoreByFunction = (path: string): boolean => {
        const found = globbySync(path, {
          cwd: fsPaths().workspaceRepo,
          ignore: DEFAULT_IGNORES,
        });
        return found.length === 0;
      };
    }
  }

  return _ignoreByFunction(path);
}

/**
 * Check a Uri to see if it should be ignored by a partial analysis on save.
 */
export const isUriIgnored = (uri: vscode.Uri): boolean => {
  if (uri.scheme !== "file") {
    return true;
  }

  const f = relative(fsPaths().workspaceRepo, uri.fsPath);
  console.log(f);
  return isIgnoredBy(f);
};

/**
 * The analyzer needs to be told what paths to exclude from processing
 * when the AnalyzerClient is initialized.  Build the array of excluded
 * paths based on the contents of the workspace folder itself and the
 * ignore files that can be found.
 *
 * Ignore files to consider:
 *   - `.konveyorignore` that works like `.gitignore`
 *   - `.gitignore`
 *   - {@link DEFAULT_FILE_IGNORES}
 *
 * Only directories will be returned.
 */
export const ignoresToExcludedPaths = () => {
  const cwd = fsPaths().workspaceRepo;
  let ignores = DEFAULT_IGNORES;

  for (const glob of IGNORE_FILE_IN_PRIORITY_ORDER) {
    const ignoreFiles = globbySync(glob, { cwd, absolute: true });
    if (ignoreFiles.length > 0) {
      console.log("Using file:", ignoreFiles[0]);
      const base = slash(relative(cwd, dirname(ignoreFiles[0])));

      ignores = readFileSync(ignoreFiles[0], "utf-8")
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#"))
        .map((pattern) => posix.join(pattern, base));

      break;
    }
  }

  const exclude = globbySync(ignores, {
    cwd,
    expandDirectories: false,
    dot: true,
    onlyDirectories: true,
    markDirectories: true,
    absolute: true,
    unique: true,
  });
  return exclude;
};
