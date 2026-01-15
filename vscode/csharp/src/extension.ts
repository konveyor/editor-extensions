import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import winston from "winston";
import { OutputChannelTransport } from "winston-transport-vscode";
import * as rpc from "vscode-jsonrpc/node";
import type { KonveyorCoreApi } from "@editor-extensions/shared";
import { CSharpExternalProviderManager } from "./csharpExternalProviderManager";
import { CORE_EXTENSION_ID, EXTENSION_DISPLAY_NAME, EXTENSION_ID } from "./utilities/constants";

/**
 * Find a dotnet global tool path.
 * Dotnet global tools are installed to ~/.dotnet/tools
 */
function findDotnetToolPath(toolName: string): string | undefined {
  const isWindows = process.platform === "win32";
  const executableName = isWindows ? `${toolName}.exe` : toolName;
  const toolPath = path.join(os.homedir(), ".dotnet", "tools", executableName);

  if (fs.existsSync(toolPath)) {
    return toolPath;
  }

  return undefined;
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
        filename: vscode.Uri.joinPath(context.logUri, "csharp-extension.log").fsPath,
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

  // Find tool paths for provider configuration
  // The C# provider's auto-detect looks for "ilspy" but the tool is "ilspycmd",
  // so we need to find and pass the actual paths explicitly
  const ilspyCmdPath = findDotnetToolPath("ilspycmd");
  const paketCmdPath = findDotnetToolPath("paket");

  // Check for required tools by looking at file system (more reliable than PATH)
  const missingTools: string[] = [];

  if (!ilspyCmdPath) {
    logger.warn("ilspycmd not found at ~/.dotnet/tools/");
    missingTools.push("ilspycmd");
  } else {
    logger.info(`Found ilspycmd at: ${ilspyCmdPath}`);
  }

  if (!paketCmdPath) {
    logger.warn("paket not found at ~/.dotnet/tools/");
    missingTools.push("paket");
  } else {
    logger.info(`Found paket at: ${paketCmdPath}`);
  }

  if (missingTools.length > 0) {
    const missingList = missingTools.join(", ");
    vscode.window.showWarningMessage(
      `C# analyzer is missing required tools: ${missingList}. ` +
        `Install them with: 'dotnet tool install --global ilspycmd' and 'dotnet tool install --global paket'`,
    );
  }

  // Get core extension API
  const coreExtension = vscode.extensions.getExtension(CORE_EXTENSION_ID);
  if (!coreExtension) {
    const message = `${EXTENSION_DISPLAY_NAME} requires the core extension to be installed`;
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

  // Create socket path for C# provider communication
  const providerSocketPath = rpc.generateRandomPipeName(); // GRPC socket for c-sharp-analyzer-provider

  logger.info("Socket path generated", {
    providerSocket: providerSocketPath,
  });

  // Start C# analyzer provider subprocess
  let providerManager: CSharpExternalProviderManager;

  try {
    providerManager = new CSharpExternalProviderManager(providerSocketPath, context, logger);
    await providerManager.start();
    context.subscriptions.push(providerManager);
  } catch (err) {
    const message =
      "Failed to start c-sharp-analyzer-provider. C# analysis will be disabled. " +
      `Error: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(message, err);
    vscode.window.showWarningMessage(
      "C# analyzer provider could not start. C# analysis will be disabled.",
    );
    return;
  }

  // Get workspace location for analysis
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const workspaceLocation = workspaceFolder?.uri.fsPath || process.cwd();

  // Format provider address for GRPC
  // Windows named pipes: unix:\\.\pipe\vscode-ipc-123
  // Unix domain sockets: unix:///tmp/vscode-ipc-123.sock
  const providerAddress = `unix://${providerSocketPath}`;

  logger.info("Provider configuration", {
    providerAddress,
    workspaceLocation,
  });

  // Register C# provider with core
  const providerDisposable = coreApi.registerProvider({
    name: "csharp",
    providerConfig: {
      name: "csharp",
      address: providerAddress, // GRPC socket address
      useSocket: true,
      initConfig: [
        {
          location: workspaceLocation,
          analysisMode: "source-only",
          providerSpecificConfig: {
            // Pass explicit paths since provider auto-detect looks for "ilspy" not "ilspycmd"
            ...(ilspyCmdPath && { ilspy_cmd: ilspyCmdPath }),
            ...(paketCmdPath && { paket_cmd: paketCmdPath }),
          },
        },
      ],
      contextLines: 10,
    },
    rulesetsPaths: [
      // In Phase 1, rulesets are still in core extension
      // Will be moved to C# extension in later phase if needed
    ],
  });

  context.subscriptions.push(providerDisposable);

  // Subscribe to analysis completion events
  const analysisCompleteDisposable = coreApi.onAnalysisComplete((results) => {
    logger.info("Analysis complete", results);
  });

  context.subscriptions.push(analysisCompleteDisposable);

  logger.info("Konveyor C# extension activated and registered with core", {
    providerSocket: providerSocketPath,
    workspaceLocation,
  });
}

export function deactivate() {
  console.log("Konveyor C# extension is now deactivated");
}
