import * as vscode from "vscode";
import winston from "winston";
import { OutputChannelTransport } from "winston-transport-vscode";
import * as rpc from "vscode-jsonrpc/node";
import type { KonveyorCoreApi } from "@editor-extensions/shared";
import { vscodeProxyServer } from "./vscodeProxyServer";
import { JavaScriptExternalProviderManager } from "./javascriptExternalProviderManager";

const EXTENSION_DISPLAY_NAME = "Konveyor Javascript";
const EXTENSION_ID = "konveyor.konveyor-javascript";

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

  // Start generic-external-provider subprocess (GRPC over UDS)
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
  // analyzer-lsp expects: passthrough:unix://\\.\pipe\... for Windows named pipes
  // analyzer-lsp expects: unix:/path for Unix domain sockets
  const providerAddress =
    process.platform === "win32"
      ? `passthrough:unix://${providerSocketPath}` // Windows: analyzer-lsp format (see provider/grpc/socket/pipe_windows.go:27)
      : `unix:${providerSocketPath}`; // Unix: standard format

  logger.info("Provider configuration", {
    platform: process.platform,
    providerAddress,
    workspaceLocation,
    providerSocketPath,
  });

  // Register JavaScript provider with core
  const providerDisposable = coreApi.registerProvider({
    name: "javascript",
    providerConfig: {
      name: "nodejs",
      address: providerAddress, // GRPC socket address
      useSocket: true,
      initConfig: [
        {
          location: workspaceLocation,
          analysisMode: "source-only",
          pipeName: lspProxySocketPath, // JSON-RPC socket for vscode proxy communication
          providerSpecificConfig: {
            lspServerName: "nodejs",
          },
        },
      ],
      contextLines: 10,
    },
    rulesetsPaths: [
      // In Phase 1, rulesets are still in core extension
      // Will be moved to JavaScript extension in later phase
    ],
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
    workspaceLocation,
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
