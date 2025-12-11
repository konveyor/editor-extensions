import { relative, dirname, posix, join } from "node:path";
import { readFileSync, createWriteStream, createReadStream } from "node:fs";
import { globbySync, isIgnoredByIgnoreFilesSync } from "globby";
import * as vscode from "vscode";
import slash from "slash";
import winston from "winston";
import { createHash } from "node:crypto";
import { mkdir, chmod, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { platform, arch } from "node:process";
import { existsSync } from "node:fs";
import { getConfigAnalyzerPath } from "./utilities/configuration";
import { EXTENSION_NAME } from "./utilities/constants";
import AdmZip from "adm-zip";
import { getDispatcherWithCertBundle, getFetchWithDispatcher } from "./utilities/tls";

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

    const isValid = await checkIfExecutable(userAnalyzerPath);
    if (!isValid) {
      logger.warn(
        `Invalid analyzer path detected at startup: ${userAnalyzerPath}. Using bundled binary.`,
      );
      vscode.window.showErrorMessage(
        `The configured analyzer binary path is invalid: ${userAnalyzerPath}. ` +
          `Using bundled binary.`,
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

  // Create fetch function that handles corporate environments:
  // - Proxy support (HTTPS_PROXY, HTTP_PROXY env vars)
  // - Corporate CA certificates (NODE_EXTRA_CA_CERTS env var)
  // - TLS/SSL configuration
  // Note: undici requires explicit certificate passing, it doesn't automatically
  // use NODE_EXTRA_CA_CERTS like Node.js's built-in https module does
  const extraCerts = process.env.NODE_EXTRA_CA_CERTS;
  const dispatcher = await getDispatcherWithCertBundle(extraCerts, false, false);
  const proxyAwareFetch = getFetchWithDispatcher(dispatcher);

  // Log environment configuration for troubleshooting
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (proxyUrl) {
    logger.info(`Using proxy: ${proxyUrl}`);
  }
  if (extraCerts) {
    logger.info(`Using custom CA certificates from: ${extraCerts}`);
  }
  if (!proxyUrl && !extraCerts) {
    logger.info("Using direct connection with default system certificates");
  }

  // Download and parse sha256sum.txt to get expected SHA (with retries)
  let sha256Content: string;
  try {
    const sha256Response = await proxyAwareFetch(sha256sumUrl, {
      signal: AbortSignal.timeout(30000), // 30 second timeout for small file
    });
    if (!sha256Response.ok) {
      throw new Error(`HTTP ${sha256Response.status}: ${sha256Response.statusText}`);
    }
    sha256Content = await sha256Response.text();
  } catch (error: any) {
    throw new Error(
      `Failed to download SHA256 checksums from ${sha256sumUrl}. ` +
        `Error: ${error.message}. ` +
        `This may indicate network connectivity issues or firewall restrictions.`,
    );
  }

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

      // Download zip file with retry logic for proxy environments
      const tempZipPath = join(dirname(kaiAnalyzerPath), assetConfig.file);
      const maxRetries = 3;
      const retryDelays = [2000, 5000, 10000]; // ms
      let lastError: Error | null = null;

      // Track progress interval across attempts so we can clean it up
      let progressInterval: NodeJS.Timeout | undefined;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            logger.info(`Retry attempt ${attempt}/${maxRetries} for ${downloadUrl}`);
            progress.report({ message: `Retrying download (${attempt}/${maxRetries})...` });
            await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt - 1]));
          }

          const fetchStartTime = Date.now();

          // Show progress during potential firewall buffering delay
          let elapsed = 0;
          if (attempt === 0) {
            // Only show "waiting" message on first attempt
            progressInterval = setInterval(() => {
              elapsed += 1;
              if (elapsed >= 5 && elapsed < 30) {
                progress.report({
                  message: `Downloading... (${elapsed}s - firewall may be scanning)`,
                });
              }
            }, 1000);
          }

          const response = await proxyAwareFetch(downloadUrl, {
            // 5 minute timeout to handle:
            // 1. High TTFB from firewall buffering/scanning (can be 10-30s)
            // 2. Slow network connections
            // 3. Large file size (~12MB)
            signal: AbortSignal.timeout(300000), // 5 minutes
            headers: {
              "User-Agent": "vscode-mta-extension",
              Accept: "application/zip, application/octet-stream, */*",
            },
          });

          if (progressInterval) {
            clearInterval(progressInterval);
          }

          const ttfb = Date.now() - fetchStartTime;
          logger.info(`Time-To-First-Byte: ${ttfb}ms`);

          if (ttfb > 10000) {
            logger.warn(
              `High TTFB detected (${(ttfb / 1000).toFixed(1)}s). ` +
                `This indicates firewall buffering/scanning. ` +
                `This is normal in corporate environments with anti-malware scanning.`,
            );
          }

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          if (!response.body) {
            throw new Error("Response body is null");
          }

          const fileStream = createWriteStream(tempZipPath);
          const contentLength = response.headers.get("content-length");
          let downloadedBytes = 0;
          logger.info(
            `Content-Length: ${contentLength ? `${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB` : "unknown"}`,
          );

          // Convert web ReadableStream to Node.js Readable for better compatibility
          const reader = response.body.getReader();
          const nodeStream = new (await import("stream")).Readable({
            async read() {
              try {
                const { done, value } = await reader.read();
                if (done) {
                  this.push(null);
                } else {
                  downloadedBytes += value.length;
                  // Update progress to keep connection alive
                  if (contentLength) {
                    const percent = Math.round((downloadedBytes / parseInt(contentLength)) * 100);
                    progress.report({
                      message: `Downloading... ${percent}%`,
                      increment: percent,
                    });
                  }
                  this.push(value);
                }
              } catch (error) {
                this.destroy(error as Error);
              }
            },
          });

          await pipeline(nodeStream, fileStream);
          logger.info(`Successfully downloaded ${downloadedBytes} bytes`);

          // Clean up progress interval on success
          if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = undefined;
          }

          lastError = null;
          break; // Success, exit retry loop
        } catch (error: any) {
          // Clean up progress interval on error
          if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = undefined;
          }

          lastError = error;
          logger.warn(`Download attempt ${attempt + 1} failed:`, error);

          // Clean up partial download
          try {
            if (existsSync(tempZipPath)) {
              await unlink(tempZipPath);
            }
          } catch (cleanupError) {
            logger.warn(`Failed to clean up partial download: ${cleanupError}`);
          }

          if (attempt === maxRetries) {
            // Last attempt failed - provide detailed troubleshooting information
            const errorDetails = [
              `Failed to download analyzer binary after ${maxRetries + 1} attempts.`,
              `URL: ${downloadUrl}`,
              `Error: ${error.message}`,
              `Error type: ${error.name || "Unknown"}`,
            ];

            // Add troubleshooting hints based on error type
            if (error.message.includes("CERT") || error.message.includes("certificate")) {
              errorDetails.push(
                "Certificate error detected. For corporate environments with SSL inspection:",
                "- Set NODE_EXTRA_CA_CERTS=/path/to/corporate-ca-bundle.pem",
                "- Or contact IT to get the corporate CA certificate",
              );
            } else if (
              error.message.includes("ECONNREFUSED") ||
              error.message.includes("ETIMEDOUT")
            ) {
              errorDetails.push(
                "Connection error detected. Possible causes:",
                "- Proxy configuration required (set HTTPS_PROXY environment variable)",
                "- Firewall blocking access to developers.redhat.com",
                "- Network connectivity issues",
              );
            } else if (error.message.includes("aborted") || error.message.includes("UND_ERR")) {
              errorDetails.push(
                "Download was aborted. Possible causes:",
                "- Proxy timeout (try setting a longer timeout on proxy)",
                "- Unstable network connection",
                "- Large file size (~12MB) may exceed network limits",
              );
            } else {
              errorDetails.push(
                "Troubleshooting steps:",
                `- Verify ${downloadUrl} is accessible from a browser`,
                "- Check if proxy is required (set HTTPS_PROXY if needed)",
                "- For corporate environments, verify SSL certificates (NODE_EXTRA_CA_CERTS)",
              );
            }

            throw new Error(errorDetails.join("\n"));
          }
        }
      }

      if (lastError) {
        throw lastError;
      }

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
  _logger?.debug(`isUriIgnored: ${f}`);
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
      _logger?.debug(`Using file: ${ignoreFiles[0]}`);
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
