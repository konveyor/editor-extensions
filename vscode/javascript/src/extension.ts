import * as vscode from "vscode";
import winston from "winston";
import { OutputChannelTransport } from "winston-transport-vscode";
import * as rpc from "vscode-jsonrpc/node";
import type { KonveyorCoreApi } from "@editor-extensions/shared";
import { vscodeProxyServer } from "./vscodeProxyServer";
import { JavaScriptExternalProviderManager } from "./javascriptExternalProviderManager";
import { execFile } from "child_process";
import { promisify } from "util";

const EXTENSION_DISPLAY_NAME = "Konveyor Javascript";
const EXTENSION_ID = "konveyor.konveyor-javascript";

/**
 * Check if a command is available on the system
 */
async function checkCommand(command: string, versionFlag = "--version"): Promise<boolean> {
  try {
    await promisify(execFile)(command, [versionFlag]);
    return true;
  } catch {
    return false;
  }
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
  const coreExtension = vscode.extensions.getExtension("konveyor.konveyor");
  if (!coreExtension) {
    const message =
      "Konveyor Javascript extension requires Konveyor Core extension to be installed";
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
  const lspProxyServer = new vscodeProxyServer(lspProxySocketPath, logger);
  await lspProxyServer.start();
  context.subscriptions.push(lspProxyServer);

  // Start java-external-provider subprocess (GRPC over UDS)
  const providerManager = new JavaScriptExternalProviderManager(
    providerSocketPath,
    context,
    logger,
  );
  await providerManager.start();
  context.subscriptions.push(providerManager);

  // Get workspace location for analysis
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceLocation = workspaceFolder?.uri.fsPath || process.cwd();

  // Format provider address for GRPC
  // Windows named pipes: unix:\\.\pipe\vscode-ipc-123
  // Unix domain sockets: unix:///tmp/vscode-ipc-123.sock
  const providerAddress = `unix:${providerSocketPath}`;

  logger.info("Provider configuration", {
    providerAddress,
    workspaceLocation,
  });

  // Register Java provider with core
  const providerDisposable = coreApi.registerProvider({
    name: "javascript",
    providerConfig: {
      name: "javascript",
      address: providerAddress, // GRPC socket address
      useSockets: true,
      initConfig: [
        {
          location: workspaceLocation,
          analysisMode: "source-only",
          pipeName: lspProxySocketPath, // JSON-RPC socket for JDTLS communication
        },
      ],
      contextLines: 10,
    },
    getBundleMetadata: () => ({
      // These are example values - should be loaded from actual ruleset metadata
      sources: ["fake"],
      targets: ["data"],
    }),
    supportsFileExtensions: [".ts", ".js", ".tsx", "jsx"],
    rulesetsPaths: [
      // In Phase 1, rulesets are still in core extension
      // Will be moved to java extension in later phase
      // TODO: Use the rulesets that Todd Has
    ],
  });

  context.subscriptions.push(providerDisposable);

  // Subscribe to analysis completion events
  const analysisCompleteDisposable = coreApi.onAnalysisComplete((results) => {
    logger.info("Analysis complete", results);
  });

  context.subscriptions.push(analysisCompleteDisposable);

  logger.info("Konveyor Java extension activated and registered with core", {
    providerSocket: providerSocketPath,
    lspProxySocket: lspProxySocketPath,
    workspaceLocation,
  });
}

export function deactivate() {
  // Logger may not be available at this point
  console.log("Konveyor Java extension is now deactivated");
}
