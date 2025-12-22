import * as vscode from "vscode";
import { exec } from "node:child_process";
import winston from "winston";
import { OutputChannelTransport } from "winston-transport-vscode";
import * as rpc from "vscode-jsonrpc/node";
import type { KonveyorCoreApi } from "@editor-extensions/shared";
import { GoVscodeProxyServer } from "./goVscodeProxyServer";
import { GoExternalProviderManager } from "./goExternalProviderManager";
import { getDependencyProviderBinaryPath } from "./pathUtils";

const EXTENSION_DISPLAY_NAME = "Konveyor Go";
const EXTENSION_ID = "konveyor.konveyor-go";

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
  const coreExtension = vscode.extensions.getExtension("konveyor.konveyor");
  if (!coreExtension) {
    const message = "Konveyor Go extension requires Konveyor Core extension to be installed";
    logger.error(message);
    vscode.window.showErrorMessage(message);
    return;
  }

  logger.info("Found Konveyor Core extension, activating...");

  let coreApi: KonveyorCoreApi;
  try {
    coreApi = await coreExtension.activate();
  } catch (err) {
    const message = "Failed to activate Konveyor Core extension.";
    logger.error(message, err);
    vscode.window.showErrorMessage(message);
    return;
  }

  // Create socket paths for communication
  const providerSocketPath = rpc.generateRandomPipeName(); // GRPC socket for kai-analyzer-rpc
  const lspProxySocketPath = rpc.generateRandomPipeName(); // JSON-RPC socket for vscode proxy

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

  // Get workspace location for analysis
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceLocation = workspaceFolder?.uri.fsPath || process.cwd();

  // Get golang-dependency-provider path
  const dependencyProviderPath = getDependencyProviderBinaryPath(context);

  // Format provider address for GRPC
  // Windows named pipes: unix:\\.\pipe\vscode-ipc-123
  // Unix domain sockets: unix:///tmp/vscode-ipc-123.sock
  const providerAddress = `unix://${providerSocketPath}`;

  logger.info("Provider configuration", {
    providerAddress,
    workspaceLocation,
    dependencyProviderPath,
  });

  // Register Go provider with core
  const providerDisposable = coreApi.registerProvider({
    name: "go",
    providerConfig: {
      name: "go",
      address: providerAddress, // GRPC socket address
      useSocket: true,
      initConfig: [
        {
          location: workspaceLocation,
          analysisMode: "source-only",
          pipeName: lspProxySocketPath, // JSON-RPC socket for vscode proxy communication
          providerSpecificConfig: {
            lspServerName: "generic",
            dependencyProviderPath: dependencyProviderPath,
          },
        },
      ],
      contextLines: 10,
    },
    rulesetsPaths: [
      // In Phase 1, rulesets are still in core extension
      // Will be moved to Go extension in later phase
    ],
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
    workspaceLocation,
  });
}

export function deactivate() {
  console.log("Konveyor Go extension is now deactivated");
}
