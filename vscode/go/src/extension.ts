import * as vscode from "vscode";
import { exec } from "node:child_process";
import { dirname } from "node:path";
import winston from "winston";
import { OutputChannelTransport } from "winston-transport-vscode";
import {
  type KonveyorCoreApi,
  generateSafePipeName,
  getIncludedRulesetsPath,
  analysisLocations,
  MAX_ANALYSIS_LOCATIONS,
} from "@editor-extensions/shared";
import { GoVscodeProxyServer } from "./goVscodeProxyServer";
import { GoExternalProviderManager } from "./goExternalProviderManager";
import {
  CORE_EXTENSION_ID,
  EXTENSION_DISPLAY_NAME,
  EXTENSION_ID,
  EXTENSION_NAME,
  EXTENSION_VERSION,
} from "./utilities/constants";

/** Files that mark a directory as the root of a Go module */
const GO_PROJECT_FILES = ["go.mod", "go.sum"];

/** Directories that never hold the project a workspace folder was opened for */
const PROJECT_SEARCH_EXCLUDE = "**/{node_modules,vendor,target,build,dist,out,.git}/**";

/** Upper bound on the project files a single folder's search may return */
const MAX_PROJECT_FILES = 200;

/**
 * Find the Go modules in a workspace folder: the folder itself when it holds
 * a module file, otherwise the directories of the modules nested inside it.
 * The provider makes the location the language server's root, so a nested
 * module has to be given its own directory rather than the folder above it.
 */
async function findProjectDirs(folder: vscode.WorkspaceFolder): Promise<string[]> {
  for (const projectFile of GO_PROJECT_FILES) {
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
    GO_PROJECT_FILES.map((projectFile) =>
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
 * Resolve the analysis locations: one per Go module across all workspace
 * folders. Folders without a module contribute nothing, and a workspace with
 * no module at all falls back to the first folder, so this is never worse off
 * than analyzing that folder alone.
 */
async function getAnalysisLocations(logger: winston.Logger): Promise<string[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return [process.cwd()];
  }

  // Reduced within each folder, not across them: a project below another
  // folder's project on disk is not thereby one of its modules.
  const locations = analysisLocations(await Promise.all(folders.map(findProjectDirs)));
  if (locations.length === 0) {
    logger.info("No Go module found in the workspace, analyzing the first folder");
    return [folders[0].uri.fsPath];
  }
  if (locations.length > MAX_ANALYSIS_LOCATIONS) {
    logger.warn(
      `Found ${locations.length} Go modules, analyzing the first ${MAX_ANALYSIS_LOCATIONS}`,
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
        filename: vscode.Uri.joinPath(context.logUri, "go-extension.log").fsPath,
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

  // Check if Go extension (golang.go) is installed
  const goExt = vscode.extensions.getExtension("golang.go");
  if (!goExt) {
    logger.warn(
      "Go extension (golang.go) not found - should have been installed via extensionDependencies",
    );
    vscode.window
      .showWarningMessage(
        "The Go extension (golang.go) is required for proper Go analysis. " +
          "Please install it from the VS Code marketplace.",
        "Install Go Extension",
      )
      .then((selection) => {
        if (selection === "Install Go Extension") {
          vscode.commands.executeCommand("workbench.extensions.search", "golang.go");
        }
      });
  } else if (!goExt.isActive) {
    vscode.window.showInformationMessage(
      "The Go extension is installed but not yet active. " +
        "Go analysis features may be limited until it's fully loaded.",
    );
  }

  // Check if Go runtime binary is installed
  await new Promise<void>((resolve) => {
    exec("go version", { timeout: 5000 }, (error, stdout, _stderr) => {
      if (error) {
        logger.warn("Go runtime not found in PATH", { error: error.message });
        vscode.window.showWarningMessage(
          "Go runtime (go command) was not found in your PATH. " +
            "Go analysis features may not work properly. " +
            "Please install Go from https://go.dev/dl/",
        );
      } else {
        const version = stdout.trim();
        logger.info(`Go runtime detected: ${version}`);
      }
      resolve();
    });
  });

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

  // Check version compatibility
  const goExtVersion = EXTENSION_VERSION;
  const coreExtVersion = coreApi.version;
  if (goExtVersion !== coreExtVersion) {
    const message =
      `Version mismatch detected!\n\n` +
      `${EXTENSION_DISPLAY_NAME} (v${goExtVersion}) is not compatible with the core extension (v${coreExtVersion}).\n\n` +
      `Please ensure both extensions are at the same version. This mismatch can cause analysis failures and unexpected behavior.`;
    logger.error(message, {
      goVersion: goExtVersion,
      coreVersion: coreExtVersion,
    });
    vscode.window.showErrorMessage(message);
    return;
  }

  logger.info("Version compatibility check passed", {
    goVersion: goExtVersion,
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
  let lspProxyServer: GoVscodeProxyServer;
  let providerManager: GoExternalProviderManager;

  try {
    lspProxyServer = new GoVscodeProxyServer(lspProxySocketPath, logger);
    await lspProxyServer.start();
    context.subscriptions.push(lspProxyServer);
  } catch (err) {
    const message =
      "Failed to start Go LSP proxy server. Go analysis will be disabled. " +
      `Error: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(message, err);
    vscode.window.showWarningMessage(
      "Go provider could not start: LSP proxy server failed. Go analysis will be disabled.",
    );
    return;
  }

  try {
    // Start go-external-provider subprocess (GRPC over UDS)
    providerManager = new GoExternalProviderManager(providerSocketPath, context, logger);
    await providerManager.start();
    context.subscriptions.push(providerManager);
  } catch (err) {
    const message =
      "Failed to start go-external-provider. Go analysis will be disabled. " +
      `Error: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(message, err);
    vscode.window.showWarningMessage("Go provider could not start. Go analysis will be disabled.");
    // Clean up LSP proxy server since we won't be using it
    lspProxyServer.dispose();
    return;
  }

  // Get workspace locations for analysis (one per Go module)
  const workspaceLocations = await getAnalysisLocations(logger);

  // Format provider address for GRPC
  // analyzer-lsp expects: passthrough:unix://\\.\pipe\... for Windows named pipes
  // analyzer-lsp expects: unix:/path for Unix domain sockets
  const providerAddress =
    process.platform === "win32"
      ? `passthrough:unix://${providerSocketPath}` // Windows: analyzer-lsp format (see provider/grpc/socket/pipe_windows.go:27)
      : `unix:${providerSocketPath}`; // Unix: standard format

  logger.info("Provider configuration", {
    providerAddress,
    workspaceLocations,
  });

  // Register Go provider with core
  const providerDisposable = coreApi.registerProvider({
    name: "go",
    providerConfig: {
      name: "go",
      address: providerAddress, // GRPC socket address
      useSocket: true,
      initConfig: workspaceLocations.map((location) => ({
        location,
        analysisMode: "source-only",
        pipeName: lspProxySocketPath, // JSON-RPC socket for vscode proxy communication
        providerSpecificConfig: {
          lspServerName: "go",
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

  logger.info("Konveyor Go extension activated and registered with core", {
    providerSocket: providerSocketPath,
    lspProxySocket: lspProxySocketPath,
    workspaceLocations,
  });
}

export function deactivate() {
  console.log("Konveyor Go extension is now deactivated");
}
