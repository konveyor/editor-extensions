import * as vscode from "vscode";
import { dirname } from "node:path";
import winston from "winston";
import { OutputChannelTransport } from "winston-transport-vscode";
import {
  KonveyorCoreApi,
  generateSafePipeName,
  getIncludedRulesetsPath,
  topMostDirs,
  MAX_ANALYSIS_LOCATIONS,
} from "@editor-extensions/shared";
import {
  CORE_EXTENSION_ID,
  EXTENSION_DISPLAY_NAME,
  EXTENSION_ID,
  EXTENSION_NAME,
  EXTENSION_VERSION,
} from "./utilities/constants";
import { vscodeProxyServer } from "./vscodeProxyServer";
import { JavaScriptExternalProviderManager } from "./javascriptExternalProviderManager";

/** Files that mark a directory as the root of a JavaScript project */
const JAVASCRIPT_PROJECT_FILES = ["package.json", "jsconfig.json", "tsconfig.json"];

/** Directories that never hold the project a workspace folder was opened for */
const PROJECT_SEARCH_EXCLUDE = "**/{node_modules,target,build,dist,out,.git}/**";

/** Upper bound on the project files a single folder's search may return */
const MAX_PROJECT_FILES = 200;

/**
 * Find the JavaScript projects in a workspace folder: the folder itself when
 * it holds a project file, otherwise the directories of the projects nested
 * inside it. The provider makes the location the language server's root, so a
 * nested project has to be given its own directory rather than the folder
 * above it.
 */
async function findProjectDirs(folder: vscode.WorkspaceFolder): Promise<string[]> {
  for (const projectFile of JAVASCRIPT_PROJECT_FILES) {
    const atFolderRoot = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, projectFile),
      null,
      1,
    );
    if (atFolderRoot.length > 0) {
      return [folder.uri.fsPath];
    }
  }

  const nested = await Promise.all(
    JAVASCRIPT_PROJECT_FILES.map((projectFile) =>
      vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, `**/${projectFile}`),
        PROJECT_SEARCH_EXCLUDE,
        MAX_PROJECT_FILES,
      ),
    ),
  );
  return nested.flat().map((uri) => dirname(uri.fsPath));
}

/**
 * Resolve the analysis locations: one per JavaScript project across all
 * workspace folders. Folders without a project contribute nothing, and a
 * workspace with no project at all falls back to the first folder, so this is
 * never worse off than analyzing that folder alone.
 */
async function getAnalysisLocations(logger: winston.Logger): Promise<string[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return [process.cwd()];
  }

  const projectDirs = (await Promise.all(folders.map(findProjectDirs))).flat();
  // A folder opened on its own stays a location even when another folder
  // contains it: being below a project on disk does not make it one of that
  // project's modules.
  const locations = topMostDirs(
    projectDirs,
    folders.map((folder) => folder.uri.fsPath),
  );
  if (locations.length === 0) {
    logger.info("No JavaScript project found in the workspace, analyzing the first folder");
    return [folders[0].uri.fsPath];
  }
  if (locations.length > MAX_ANALYSIS_LOCATIONS) {
    logger.warn(
      `Found ${locations.length} JavaScript projects, analyzing the first ${MAX_ANALYSIS_LOCATIONS}`,
    );
  }
  return locations.slice(0, MAX_ANALYSIS_LOCATIONS);
}

export async function activate(context: vscode.ExtensionContext) {
  // Setup logger
  const outputChannel = vscode.window.createOutputChannel(EXTENSION_DISPLAY_NAME);
  const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    ),
    transports: [
      new winston.transports.File({
        filename: vscode.Uri.joinPath(context.logUri, "javascript-extension.log").fsPath,
        maxsize: 10 * 1024 * 1024, // 10MB
        maxFiles: 3,
      }),
      new OutputChannelTransport({
        outputChannel,
      }),
    ],
  });

  logger.info("Logger created");
  logger.info(`Extension ${EXTENSION_ID} starting`);

  // Typescript Language Server comes with VS code ASFAICT

  // Get core extension API
  const coreExtension = vscode.extensions.getExtension(CORE_EXTENSION_ID);
  if (!coreExtension) {
    const message = `${EXTENSION_DISPLAY_NAME} requires the core extension to be installed`;
    logger.error(message);
    vscode.window.showErrorMessage(message);
    return;
  }

  logger.info("Found core extension, activating...");

  let coreApi: KonveyorCoreApi;
  try {
    coreApi = await coreExtension.activate();
  } catch (err) {
    const message = "Failed to activate core extension.";
    logger.error(message, err);
    vscode.window.showErrorMessage(message);
    return;
  }

  const tsExt = vscode.extensions.getExtension("vscode.typescript-language-features");
  if (!tsExt) {
    vscode.window.showErrorMessage("TypeScript extension not found.");
    return;
  }
  try {
    await tsExt.activate();
  } catch (error) {
    logger.error("Failed to activate ts extension", { error });
  }

  // Check version compatibility
  const javascriptExtVersion = EXTENSION_VERSION;
  const coreExtVersion = coreApi.version;
  if (javascriptExtVersion !== coreExtVersion) {
    const message =
      `Version mismatch detected!\n\n` +
      `${EXTENSION_DISPLAY_NAME} (v${javascriptExtVersion}) is not compatible with the core extension (v${coreExtVersion}).\n\n` +
      `Please ensure both extensions are at the same version. This mismatch can cause analysis failures and unexpected behavior.`;
    logger.error(message, {
      javascriptVersion: javascriptExtVersion,
      coreVersion: coreExtVersion,
    });
    vscode.window.showErrorMessage(message);
    return;
  }

  logger.info("Version compatibility check passed", {
    javascriptVersion: javascriptExtVersion,
    coreVersion: coreExtVersion,
  });

  // Create socket paths for communication
  const providerSocketPath = generateSafePipeName(EXTENSION_NAME); // GRPC socket for kai-analyzer-rpc
  const lspProxySocketPath = generateSafePipeName(EXTENSION_NAME); // JSON-RPC socket for vscode proxy

  logger.info("Socket paths generated", {
    providerSocket: providerSocketPath,
    lspProxySocket: lspProxySocketPath,
  });

  // Start LSP proxy server (JSON-RPC over UDS)
  let lspProxyServer: vscodeProxyServer;
  let providerManager: JavaScriptExternalProviderManager;

  try {
    lspProxyServer = new vscodeProxyServer(lspProxySocketPath, logger);
    await lspProxyServer.start();
    context.subscriptions.push(lspProxyServer);
  } catch (err) {
    const message =
      "Failed to start JavaScript LSP proxy server. JavaScript analysis will be disabled. " +
      `Error: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(message, err);
    vscode.window.showWarningMessage(
      "JavaScript provider could not start: LSP proxy server failed. JavaScript analysis will be disabled.",
    );
    return;
  }

  try {
    // Start generic-external-provider subprocess (GRPC over UDS)
    providerManager = new JavaScriptExternalProviderManager(providerSocketPath, context, logger);
    await providerManager.start();
    context.subscriptions.push(providerManager);
  } catch (err) {
    const message =
      "Failed to start javascript-external-provider. JavaScript analysis will be disabled. " +
      `Error: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(message, err);
    vscode.window.showWarningMessage(
      "JavaScript provider could not start. JavaScript analysis will be disabled.",
    );
    // Clean up LSP proxy server since we won't be using it
    lspProxyServer.dispose();
    return;
  }

  // Get workspace locations for analysis (one per JavaScript project)
  const workspaceLocations = await getAnalysisLocations(logger);

  // Format provider address for GRPC
  // analyzer-lsp expects: passthrough:unix://\\.\pipe\... for Windows named pipes
  // analyzer-lsp expects: unix:/path for Unix domain sockets
  const providerAddress =
    process.platform === "win32"
      ? `passthrough:unix://${providerSocketPath}` // Windows: analyzer-lsp format (see provider/grpc/socket/pipe_windows.go:27)
      : `unix:${providerSocketPath}`; // Unix: standard format

  logger.info("Provider configuration", {
    platform: process.platform,
    providerAddress,
    workspaceLocations,
    providerSocketPath,
  });

  // Register JavaScript provider with core
  const providerDisposable = coreApi.registerProvider({
    name: "javascript",
    providerConfig: {
      name: "nodejs",
      address: providerAddress, // GRPC socket address
      useSocket: true,
      initConfig: workspaceLocations.map((location) => ({
        location,
        analysisMode: "source-only",
        pipeName: lspProxySocketPath, // JSON-RPC socket for vscode proxy communication
        providerSpecificConfig: {
          lspServerName: "nodejs",
        },
      })),
      contextLines: 10,
    },
    rulesetsPaths: [context.asAbsolutePath(getIncludedRulesetsPath(context.extension.packageJSON))],
  });

  context.subscriptions.push(providerDisposable);

  // Subscribe to analysis completion events
  const analysisCompleteDisposable = coreApi.onAnalysisComplete((results) => {
    logger.info("Analysis complete", results);
  });

  context.subscriptions.push(analysisCompleteDisposable);

  logger.info("Konveyor JavaScript extension activated and registered with core", {
    providerSocket: providerSocketPath,
    lspProxySocket: lspProxySocketPath,
    workspaceLocations,
  });

  // Warm up TypeScript server so providers work even with no JS/TS editor open
  await warmUpTypeScriptServer(logger);
}

export function deactivate() {
  // Logger may not be available at this point
  console.log("Konveyor JavaScript extension is now deactivated");
}

let tsWarmupOnce: Promise<void> | null = null;

async function warmUpTypeScriptServer(logger: winston.Logger) {
  if (tsWarmupOnce) {
    return tsWarmupOnce;
  }
  tsWarmupOnce = (async () => {
    try {
      // If a JS/TS document is already open, no need to open anything
      const existing = vscode.workspace.textDocuments.find((d) =>
        ["javascript", "javascriptreact", "typescript", "typescriptreact"].includes(d.languageId),
      );
      if (existing) {
        logger.info("TypeScript server warm-up skipped; JS/TS document already open", {
          file: existing.uri.fsPath,
        });
        return;
      }
      const exclude =
        "{**/node_modules/**,**/dist/**,**/build/**,**/out/**,**/.git/**,**/.yarn/**}";
      const [tsFiles, tsxFiles, jsFiles, jsxFiles] = await Promise.all([
        vscode.workspace.findFiles("**/*.ts", exclude, 1),
        vscode.workspace.findFiles("**/*.tsx", exclude, 1),
        vscode.workspace.findFiles("**/*.js", exclude, 1),
        vscode.workspace.findFiles("**/*.jsx", exclude, 1),
      ]);
      if (!tsFiles.length && !tsxFiles.length && !jsFiles.length && !jsxFiles.length) {
        logger.warn("No JS/TS files found to warm up the TypeScript server");
        return;
      }
      const files = [...tsFiles, ...tsxFiles, ...jsFiles, ...jsxFiles];
      logger.info("Warming up TypeScript server using files", {
        files: files.map((f) => f.fsPath),
      });
      await Promise.all(files.map((f) => vscode.workspace.openTextDocument(f)));
      await Promise.all(
        files.map((f) => vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", f)),
      );
      await waitForDiagnosticsForUris(files, 8000, logger);
      logger.info("TypeScript server warm-up complete");
    } catch (err) {
      logger.warn("Failed to warm up TypeScript server", err as Error);
    }
  })();
  return tsWarmupOnce;
}

async function waitForDiagnosticsForUris(
  uris: vscode.Uri[],
  timeoutMs: number,
  logger: winston.Logger,
) {
  const remaining = new Set(uris.map((u) => u.toString()));
  for (const [uri] of vscode.languages.getDiagnostics()) {
    remaining.delete(uri.toString());
  }
  if (remaining.size === 0) {
    return;
  }
  let sub: vscode.Disposable | undefined;
  await Promise.race<void>([
    new Promise<void>((resolve) => {
      sub = vscode.languages.onDidChangeDiagnostics((e) => {
        for (const changed of e.uris) {
          remaining.delete(changed.toString());
        }
        if (remaining.size === 0) {
          resolve();
        }
      });
    }),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        logger.info("Diagnostics wait timed out", {
          pending: Array.from(remaining),
        });
        resolve();
      }, timeoutMs),
    ),
  ]);
  sub?.dispose();
}
