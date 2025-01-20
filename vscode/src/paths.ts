import * as vscode from "vscode";

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
