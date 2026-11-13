import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import winston from "winston";
import { OutputChannelTransport } from "winston-transport-vscode";
import {
  type KonveyorCoreApi,
  generateSafePipeName,
  getIncludedRulesetsPath,
  analysisLocations,
  MAX_ANALYSIS_LOCATIONS,
} from "@editor-extensions/shared";
import { CSharpExternalProviderManager } from "./csharpExternalProviderManager";
import {
  CORE_EXTENSION_ID,
  EXTENSION_DISPLAY_NAME,
  EXTENSION_ID,
  EXTENSION_NAME,
  EXTENSION_VERSION,
} from "./utilities/constants";

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

/** Files that mark a directory as the root of a C# project */
const CSHARP_PROJECT_FILES = ["*.sln", "*.csproj"];

/** Directories that never hold the project a workspace folder was opened for */
const PROJECT_SEARCH_EXCLUDE = "**/{node_modules,bin,obj,target,build,dist,out,.git}/**";

/** Upper bound on the project files a single folder's search may return */
const MAX_PROJECT_FILES = 200;

/**
 * Find the C# projects in a workspace folder: the folder itself when it holds
 * a solution or project file, otherwise the directories of the projects
 * nested inside it. A nested project has to be given its own directory rather
 * than the folder above it, which holds nothing the provider recognizes.
 */
async function findProjectDirs(folder: vscode.WorkspaceFolder): Promise<string[]> {
  for (const projectFile of CSHARP_PROJECT_FILES) {
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
    CSHARP_PROJECT_FILES.map((projectFile) =>
      vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, `**/${projectFile}`),
        PROJECT_SEARCH_EXCLUDE,
        MAX_PROJECT_FILES,
      ),
    ),
  );
  return nested.flat().map((uri) => path.dirname(uri.fsPath));
}

/**
 * Resolve the analysis locations: one per C# project across all workspace
 * folders. Folders without a project contribute nothing, and a workspace with
 * no project at all falls back to the first folder, so this is never worse
 * off than analyzing that folder alone.
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
    logger.info("No C# project found in the workspace, analyzing the first folder");
    return [folders[0].uri.fsPath];
  }
  if (locations.length > MAX_ANALYSIS_LOCATIONS) {
    logger.warn(
      `Found ${locations.length} C# projects, analyzing the first ${MAX_ANALYSIS_LOCATIONS}`,
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

  // Check version compatibility
  const csharpExtVersion = EXTENSION_VERSION;
  const coreExtVersion = coreApi.version;
  if (csharpExtVersion !== coreExtVersion) {
    const message =
      `Version mismatch detected!\n\n` +
      `${EXTENSION_DISPLAY_NAME} (v${csharpExtVersion}) is not compatible with the core extension (v${coreExtVersion}).\n\n` +
      `Please ensure both extensions are at the same version. This mismatch can cause analysis failures and unexpected behavior.`;
    logger.error(message, {
      csharpVersion: csharpExtVersion,
      coreVersion: coreExtVersion,
    });
    vscode.window.showErrorMessage(message);
    return;
  }

  logger.info("Version compatibility check passed", {
    csharpVersion: csharpExtVersion,
    coreVersion: coreExtVersion,
  });

  // Create socket path for C# provider communication
  const providerSocketPath = generateSafePipeName(EXTENSION_NAME); // GRPC socket for c-sharp-analyzer-provider

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

  // Get workspace locations for analysis (one per C# project)
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

  // Register C# provider with core
  const providerDisposable = coreApi.registerProvider({
    name: "csharp",
    providerConfig: {
      name: "csharp",
      address: providerAddress, // GRPC socket address
      useSocket: true,
      initConfig: workspaceLocations.map((location) => ({
        location,
        analysisMode: "source-only",
        providerSpecificConfig: {
          // Pass explicit paths since provider auto-detect looks for "ilspy" not "ilspycmd"
          ...(ilspyCmdPath && { ilspy_cmd: ilspyCmdPath }),
          ...(paketCmdPath && { paket_cmd: paketCmdPath }),
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

  logger.info("Konveyor C# extension activated and registered with core", {
    providerSocket: providerSocketPath,
    workspaceLocations,
  });
}

export function deactivate() {
  console.log("Konveyor C# extension is now deactivated");
}
