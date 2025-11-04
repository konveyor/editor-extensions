import * as vscode from "vscode";
import winston from "winston";
import { OutputChannelTransport } from "winston-transport-vscode";
import * as rpc from "vscode-jsonrpc/node";
import type { KonveyorCoreApi } from "@editor-extensions/shared";
import { LspProxyServer } from "./lspProxyServer";
import { JavaExternalProviderManager } from "./javaExternalProviderManager";
import { execFile } from "child_process";
import { promisify } from "util";

const EXTENSION_DISPLAY_NAME = "Konveyor Java";
const EXTENSION_ID = "konveyor.konveyor-java";

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
        filename: vscode.Uri.joinPath(context.logUri, "java-extension.log").fsPath,
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

  // Check for Red Hat Java Language Support extension
  const javaExt = vscode.extensions.getExtension("redhat.java");
  if (!javaExt) {
    const message =
      "The Red Hat Java Language Support extension is required for Java analysis. " +
      "Please install it from the VS Code marketplace.";
    logger.error(message);
    vscode.window.showErrorMessage(message, "Install Java Extension").then((selection) => {
      if (selection === "Install Java Extension") {
        vscode.commands.executeCommand("workbench.extensions.search", "redhat.java");
      }
    });
    return;
  }

  if (!javaExt.isActive) {
    logger.info("Java Language Support extension is not yet active, waiting...");

    try {
      await javaExt.activate();
      logger.info("Java Language Support activated successfully");
    } catch (err) {
      logger.error("Failed to activate Java Language Support", err);
      vscode.window.showErrorMessage(
        "Failed to activate Java Language Support extension. Java analysis may not work correctly.",
      );
      return;
    }
  }

  // Check for Java installation
  const hasJava = await checkCommand("java");
  if (!hasJava) {
    const message =
      "Java is not installed or not available in PATH. " +
      "The Konveyor analyzer requires Java to be installed.";
    logger.error(message);
    vscode.window.showErrorMessage(message);
    return;
  }
  logger.info("Java installation detected");

  // Check for Maven installation
  const hasMaven = await checkCommand("mvn");
  if (!hasMaven) {
    const message =
      "Maven is not installed or not available in PATH. " +
      "The Konveyor analyzer requires Maven to be installed for Java project analysis.";
    logger.error(message);
    vscode.window.showErrorMessage(message);
    return;
  }
  logger.info("Maven installation detected");

  // Get core extension API
  const coreExtension = vscode.extensions.getExtension("konveyor.konveyor");
  if (!coreExtension) {
    const message = "Konveyor Java extension requires Konveyor Core extension to be installed";
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
  const lspProxySocketPath = rpc.generateRandomPipeName(); // JSON-RPC socket for JDTLS proxy

  logger.info("Socket paths generated", {
    providerSocket: providerSocketPath,
    lspProxySocket: lspProxySocketPath,
  });

  // Start LSP proxy server (JSON-RPC over UDS)
  try {
    const lspProxyServer = new LspProxyServer(lspProxySocketPath, logger);
    await lspProxyServer.start();
    context.subscriptions.push(lspProxyServer);

    // Start java-external-provider subprocess (GRPC over UDS)
    const providerManager = new JavaExternalProviderManager(providerSocketPath, context, logger);
    await providerManager.start();
    context.subscriptions.push(providerManager);
  } catch (err) {
    logger.error("Failed to start java provider", err);
    vscode.window.showErrorMessage("Failed to start java provider.");
    return;
  }

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
    name: "java",
    providerConfig: {
      name: "java",
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
    rulesetsPaths: [
      // In Phase 1, rulesets are still in core extension
      // Will be moved to java extension in later phase
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

  // Signal completion for E2E tests with a persistent status bar item
  if (process.env.__TEST_EXTENSION_END_TO_END__) {
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "__JAVA_EXTENSION_INITIALIZED__";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
  }
}

export function deactivate() {
  // Logger may not be available at this point
  console.log("Konveyor Java extension is now deactivated");
}
