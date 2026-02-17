import { relative, dirname, join } from "node:path";
import { createWriteStream, createReadStream } from "node:fs";
import { globbySync, isIgnoredByIgnoreFilesSync } from "globby";
import * as vscode from "vscode";
import winston from "winston";
import { createHash } from "node:crypto";
import { mkdir, chmod, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { platform, arch } from "node:process";
import { existsSync } from "node:fs";
import { getConfigAnalyzerPath } from "./utilities/configuration";
import { EXTENSION_NAME } from "./utilities/constants";
import {
  createIgnoreFromWorkspace,
  getIgnorePatternsForGlob,
  DEFAULT_IGNORE_PATTERNS,
} from "./utilities/ignorePatterns";
import AdmZip from "adm-zip";

/**
 * Parse a sha256sum.txt file to extract the SHA256 hash for a specific filename
 * Format: "hash  filename"
 */
function parseSha256Sum(sha256Content: string, targetFilename: string): string | null {
  const lines = sha256Content.trim().split("\n");
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const hash = parts[0];
      const filename = parts[1];
      if (filename === targetFilename) {
        return hash;
      }
    }
  }
  return null;
}

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

/**
 * Downloads and extracts the kai-analyzer-rpc binary from .zip file for the current platform if it doesn't exist
 */
export async function ensureKaiAnalyzerBinary(
  context: vscode.ExtensionContext,
  logger: winston.Logger,
): Promise<void> {
  // First check if user has configured a custom analyzer path
  const userAnalyzerPath = getConfigAnalyzerPath();

  if (userAnalyzerPath !== "") {
    logger.info(`Checking user-configured analyzer path: ${userAnalyzerPath}`);

    // Import checkIfExecutable dynamically to avoid circular imports
    const { checkIfExecutable } = await import("./utilities/fileUtils");

    const checkResult = await checkIfExecutable(userAnalyzerPath);
    if (!checkResult.isExecutable) {
      const error = checkResult.error!;
      logger.warn(`Invalid analyzer path at startup: ${error.message}`);
      vscode.window.showErrorMessage(
        `The configured analyzer binary is invalid.\n\n${error.message}\n\n${error.suggestion}\n\nUsing bundled binary instead.`,
      );
    } else {
      logger.info(`User-configured analyzer path is valid: ${userAnalyzerPath}`);
      return; // Use the user's valid path, no need to download bundled binary
    }
  }

  const packageJson = context.extension.packageJSON;
  const assetPaths = {
    kai: "./kai",
    ...packageJson.includedAssetPaths,
  };

  const platformKey = `${platform}-${arch}`;

  // Convert to absolute paths
  const kaiDir = context.asAbsolutePath(assetPaths.kai);
  const kaiAnalyzerPath = join(
    kaiDir,
    platformKey,
    `kai-analyzer-rpc${platform === "win32" ? ".exe" : ""}`,
  );

  if (existsSync(kaiAnalyzerPath)) {
    return; // Binary already exists
  }

  logger.info(`kai-analyzer-rpc not found at ${kaiAnalyzerPath}, downloading...`);

  const fallbackConfig = packageJson["fallbackAssets"];
  if (!fallbackConfig) {
    throw new Error("No fallback asset configuration found in package.json");
  }

  const assetConfig = fallbackConfig.assets[platformKey];
  if (!assetConfig) {
    throw new Error(`No fallback asset available for platform: ${platformKey}`);
  }

  const downloadUrl = `${fallbackConfig.baseUrl}${assetConfig.file}`;
  const sha256sumUrl = `${fallbackConfig.baseUrl}${fallbackConfig.sha256sumFile}`;

  logger.info(`Downloading analyzer binary from: ${downloadUrl}`);
  logger.info(`Downloading SHA256 checksums from: ${sha256sumUrl}`);

  // Download and parse sha256sum.txt to get expected SHA
  const sha256Response = await fetch(sha256sumUrl);
  if (!sha256Response.ok) {
    throw new Error(`Failed to download SHA256 checksums: HTTP ${sha256Response.status}`);
  }

  const sha256Content = await sha256Response.text();
  const expectedSha256 = parseSha256Sum(sha256Content, assetConfig.file);

  if (!expectedSha256) {
    throw new Error(`No SHA256 found for file: ${assetConfig.file}`);
  }

  logger.info(`Expected SHA256: ${expectedSha256}`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Downloading Analyzer Binary",
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "Downloading zip file..." });

      // Create target directory
      await mkdir(dirname(kaiAnalyzerPath), { recursive: true });

      // Download zip file
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const tempZipPath = join(dirname(kaiAnalyzerPath), assetConfig.file);
      const fileStream = createWriteStream(tempZipPath);
      await pipeline(response.body as any, fileStream);

      progress.report({ message: "Verifying..." });

      // Verify SHA256
      const hash = createHash("sha256");
      const verifyStream = createReadStream(tempZipPath);
      await pipeline(verifyStream, hash);
      const actualSha256 = hash.digest("hex");
      logger.info(`Actual SHA256: ${actualSha256}`);

      if (actualSha256 !== expectedSha256) {
        try {
          await unlink(tempZipPath);
        } catch (err) {
          logger.error(`Error deleting file: ${tempZipPath}`, err);
        }
        throw new Error(`SHA256 mismatch. Expected: ${expectedSha256}, Actual: ${actualSha256}`);
      }

      progress.report({ message: "Extracting..." });

      // Extract zip file
      const zip = new AdmZip(tempZipPath);
      const zipEntries = zip.getEntries();

      // Get expected binary name from asset configuration
      const expectedBinaryName = assetConfig.binaryName;
      if (!expectedBinaryName) {
        throw new Error(
          `No binary name specified in asset configuration for platform: ${platformKey}`,
        );
      }

      // Find the binary in the zip by expected name
      const binaryEntry = zipEntries.find((entry) => {
        const name = entry.entryName;
        return name === expectedBinaryName || name.endsWith(`/${expectedBinaryName}`);
      });

      if (!binaryEntry) {
        throw new Error(`Could not find ${expectedBinaryName} binary in zip file`);
      }

      // Extract the binary to the target location
      zip.extractEntryTo(binaryEntry, dirname(kaiAnalyzerPath), false, true);

      // Rename extracted file to expected name if necessary
      const extractedPath = join(dirname(kaiAnalyzerPath), binaryEntry.entryName);
      if (extractedPath !== kaiAnalyzerPath) {
        const fs = await import("node:fs/promises");
        await fs.rename(extractedPath, kaiAnalyzerPath);
      }

      // Clean up zip file
      try {
        await unlink(tempZipPath);
      } catch (err) {
        logger.warn(`Could not delete temporary zip file: ${tempZipPath}`, err);
      }

      // Make executable on Unix systems
      if (platform !== "win32") {
        await chmod(kaiAnalyzerPath, 0o755);
      }

      progress.report({ message: "Complete!" });
      logger.info(`Successfully downloaded kai-analyzer-rpc to: ${kaiAnalyzerPath}`);
    },
  );
}

export async function ensurePaths(
  context: vscode.ExtensionContext,
  logger: winston.Logger,
): Promise<ExtensionPaths> {
  _logger = logger.child({ component: "paths" });
  const globalScope = context.globalStorageUri;
  const workspaceScope = context.storageUri!;

  // Handle no workspace case gracefully
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    throw new Error("No workspace folder found");
  }

  if (vscode.workspace.workspaceFolders.length > 1) {
    const message =
      "Multi-root workspaces are not supported! Only the first workspace folder will be analyzed.";
    logger.warn(message);
    vscode.window.showWarningMessage(message);
  }

  const firstWorkspace = vscode.workspace.workspaceFolders[0];
  const workspaceRepoScope = vscode.Uri.joinPath(firstWorkspace.uri, ".vscode");
  const extResources = vscode.Uri.joinPath(context.extensionUri, "resources");
  const settings = vscode.Uri.joinPath(globalScope, "settings");
  const settingsYaml = vscode.Uri.joinPath(settings, "provider-settings.yaml");

  _paths = {
    extResources,
    workspaceRepo: firstWorkspace.uri,
    data: await ensureDirectory(workspaceRepoScope, EXTENSION_NAME.toLowerCase()),
    settings: await ensureDirectory(settings),
    settingsYaml,
    serverCwd: await ensureDirectory(workspaceScope, "kai-rpc-server"),
    serverLogs: context.logUri,
  };

  _fsPaths = {} as ExtensionFsPaths;
  for (const key of Object.keys(_paths) as Array<keyof ExtensionPaths>) {
    _fsPaths[key] = _paths[key].fsPath;
  }

  // Ensure kai-analyzer-rpc binary exists
  try {
    await ensureKaiAnalyzerBinary(context, logger);
  } catch (error) {
    logger.error("Failed to install kai analyzer:", error);
    throw error;
  }

  return _paths;
}

let _paths: ExtensionPaths | undefined = undefined;
let _fsPaths: Record<keyof ExtensionPaths, string> | undefined = undefined;
let _logger: winston.Logger | undefined = undefined;

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
          ignore: DEFAULT_IGNORE_PATTERNS,
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
  _logger?.debug(`isUriIgnored: ${f}`);

  // Always ignore .konveyor directory
  if (f.startsWith(".konveyor/") || f === ".konveyor") {
    return true;
  }

  return isIgnoredBy(f);
};

/**
 * The analyzer needs to be told what paths to exclude from processing
 * when the AnalyzerClient is initialized.  Build the array of excluded
 * paths based on the contents of the workspace folder itself and the
 * ignore files that can be found.
 *
 * Uses the `ignore` npm package which properly implements gitignore specification,
 * supporting all patterns including negation (!), rooted (/), and wildcards.
 *
 * Ignore files to consider (in priority order):
 *   - `.konveyorignore` - Konveyor-specific ignore file
 *   - `.gitignore` - Standard git ignore file
 *   - Default patterns if no ignore file found
 *
 * Only directories will be returned.
 */
export const ignoresToExcludedPaths = () => {
  const cwd = fsPaths().workspaceRepo;

  // Get ignore patterns from workspace
  const { ignoreFile } = createIgnoreFromWorkspace(cwd);
  const patterns = getIgnorePatternsForGlob(cwd);

  if (ignoreFile) {
    _logger?.debug(`Using ignore file: ${ignoreFile}`);
  } else {
    _logger?.debug(`No ignore file found, using defaults`);
  }

  // Use globby to find directories matching the ignore patterns
  // This is much more efficient than scanning everything and filtering
  const exclude = globbySync(patterns, {
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
