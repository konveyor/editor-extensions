import * as vscode from "vscode";
import { exec } from "node:child_process";
import winston from "winston";
import { OutputChannelTransport } from "winston-transport-vscode";
import * as rpc from "vscode-jsonrpc/node";
import { ProviderInitConfig, AnalysisResults } from "@editor-extensions/shared";
import { goProviderConfig } from "./goProviderConfig";
import { GoVscodeProxyServer } from "./goVscodeProxyServer";
import { GoExternalProviderManager } from "./goExternalProviderManager";

// Logger instance
let logger: winston.Logger;

// Go language configuration
const GO_LANGUAGE_ID = "go";
const SUPPORTED_SCHEMES = ["file", "untitled"];

/**
 * Go language provider for Konveyor extension
 */
class GoLanguageProvider {
  private readonly context: vscode.ExtensionContext;
  private proxyServer: GoVscodeProxyServer | null = null;
  private externalProviderManager: GoExternalProviderManager | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Register Go language provider with core extension
   */
  async register(): Promise<void> {
    logger.info("Registering Go language provider...");

    try {
      // Register language configuration
      this.registerLanguageConfiguration();

      // Register with core extension (core API is passed via activate function context)
      // The core extension activation is handled in the main activate() function
      await this.registerWithCore();

      logger.info("Go language provider registered successfully");
    } catch (error) {
      logger.error("Failed to register Go language provider:", error);
      throw error;
    }
  }

  /**
   * Register Go language configuration with VSCode
   */
  private registerLanguageConfiguration(): void {
    // TODO: Implement Go language configuration
    logger.debug("Go language configuration uses defaults");
  }

  /**
   * Register with core Konveyor extension
   */
  private async registerWithCore(): Promise<void> {
    logger.info("Attempting to register Go provider with core extension...");

    try {
      // Get core extension API (should be activated by main activate function)
      const coreExtension = vscode.extensions.getExtension("konveyor.konveyor");
      if (!coreExtension) {
        logger.error("Core Konveyor extension not found");
        throw new Error("Core Konveyor extension not found");
      }

      const coreApi = await coreExtension.activate();

      if (coreApi && coreApi.registerProvider) {
        logger.info("Provider registry found - registering Go provider");

        // Create socket paths for communication
        // - providerSocketPath: GRPC socket for kai-analyzer-rpc to connect to provider
        // - lspProxySocketPath: JSON-RPC socket for provider to connect to LSP proxy
        const providerSocketPath = rpc.generateRandomPipeName();
        const lspProxySocketPath = rpc.generateRandomPipeName();

        logger.info("Socket paths generated", {
          providerSocket: providerSocketPath,
          lspProxySocket: lspProxySocketPath,
        });

        // Start LSP proxy server (JSON-RPC over UDS)
        await this.startProxyServer(lspProxySocketPath);

        // Start external provider manager (spawns binary with GRPC socket)
        await this.startExternalProviderManager(providerSocketPath);

        // Format provider address for GRPC
        // Windows named pipes: unix:\\.\pipe\vscode-ipc-123
        // Unix domain sockets: unix:///tmp/vscode-ipc-123.sock
        const providerAddress = `unix:${providerSocketPath}`;

        logger.info("Provider configuration", {
          providerAddress,
          workspaceLocation: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
        });

        // Create provider registration
        const initConfig = this.getProviderInitConfig(providerSocketPath, lspProxySocketPath);
        const providerRegistration = goProviderConfig.createProviderRegistrationWithAddress(
          providerAddress,
          initConfig,
        );

        // Register with the provider registry
        const disposable = coreApi.registerProvider(providerRegistration);
        this.context.subscriptions.push(disposable);

        // Subscribe to analysis completion events
        const analysisCompleteDisposable = coreApi.onAnalysisComplete(
          (results: AnalysisResults) => {
            logger.info("Analysis complete", results);
          },
        );
        this.context.subscriptions.push(analysisCompleteDisposable);

        logger.info("Go provider registered successfully with core extension", {
          providerSocket: providerSocketPath,
          lspProxySocket: lspProxySocketPath,
        });
      } else {
        // Provider registry not available yet - log readiness
        logger.info("Provider registry not available - Go extension ready for future integration");
        logger.debug("Go provider config:", {
          name: "go",
          supportedExtensions: [".go", ".mod", ".sum"],
          rulesetPaths: ["../../downloaded_assets/rulesets/go"],
        });
      }
    } catch (error) {
      logger.error("Failed to register Go provider with core extension:", error);
      // Don't throw - the extension should still work independently
    }
  }

  /**
   * Start the LSP proxy server for Go
   */
  private async startProxyServer(lspProxySocketPath: string): Promise<void> {
    try {
      this.proxyServer = new GoVscodeProxyServer(lspProxySocketPath, logger);

      await this.proxyServer.start();
      logger.info(`Go proxy server started on socket: ${this.proxyServer.getSocketPath()}`);

      // Clean up on deactivation
      this.context.subscriptions.push(this.proxyServer);
    } catch (error) {
      logger.error("Failed to start Go proxy server:", error);
      throw error;
    }
  }

  /**
   * Start the external provider manager (spawns the binary process)
   */
  private async startExternalProviderManager(providerSocketPath: string): Promise<void> {
    try {
      this.externalProviderManager = new GoExternalProviderManager(
        providerSocketPath,
        this.context,
        logger,
      );

      await this.externalProviderManager.start();
      logger.info(
        `Go external provider manager started, using socket: ${this.externalProviderManager.getSocketPath()}`,
      );

      // Clean up on deactivation
      this.context.subscriptions.push(this.externalProviderManager);
    } catch (error) {
      logger.error("Failed to start Go external provider manager:", error);
      // Don't throw - the extension can still work without the external provider
      // (though analysis capabilities may be limited)
      logger.warn(
        "Continuing without external provider manager. Some Go analysis features may not be available.",
      );
    }
  }

  /**
   * Get initialization config for provider registration
   */
  private getProviderInitConfig(
    providerSocketPath: string,
    lspProxySocketPath: string,
  ): ProviderInitConfig {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const workspaceLocation = workspaceFolders?.[0]?.uri.fsPath || process.cwd();

    return {
      location: workspaceLocation,
      analysisMode: "source-only", // Default mode, can be configured later
      providerSpecificConfig: {
        // Add Go-specific configuration here if needed
      },
      pipeName: lspProxySocketPath, // JSON-RPC socket for LSP communication
    };
  }

  /**
   * Stop the proxy server
   */
  public async stopProxyServer(): Promise<void> {
    if (this.proxyServer) {
      this.proxyServer.dispose();
      this.proxyServer = null;
    }
  }

  /**
   * Stop the external provider manager
   */
  public async stopExternalProviderManager(): Promise<void> {
    if (this.externalProviderManager) {
      this.externalProviderManager.dispose();
      this.externalProviderManager = null;
    }
  }

  /**
   * Check if file is supported by this provider
   */
  isFileSupported(document: vscode.TextDocument): boolean {
    // Check if document scheme is supported
    if (!SUPPORTED_SCHEMES.includes(document.uri.scheme)) {
      return false;
    }

    // Check language ID
    if (document.languageId === GO_LANGUAGE_ID) {
      return true;
    }

    // Use provider config for file extension check
    return goProviderConfig.isFileSupported(document.fileName);
  }

  /**
   * Check if Go extension (golang.go) is installed
   */
  checkGoExtensionInstalled(): void {
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
      return;
    }

    if (!goExt.isActive) {
      vscode.window.showInformationMessage(
        "The Go extension is installed but not yet active. " +
          "Go analysis features may be limited until it's fully loaded.",
      );
    }
  }

  /**
   * Check if Go runtime binary is installed
   */
  async checkGoRuntimeInstalled(): Promise<void> {
    return new Promise<void>((resolve) => {
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
  }
}

// Extension state
let goProvider: GoLanguageProvider | undefined;

const EXTENSION_DISPLAY_NAME = "Konveyor Go";
const EXTENSION_ID = "konveyor.konveyor-go";

/**
 * Initialize logger
 */
function initializeLogger(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(EXTENSION_DISPLAY_NAME);
  logger = winston.createLogger({
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
}

/**
 * Extension activation function
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Setup logger
  initializeLogger(context);
  logger.info("Logger created");
  logger.info(`Extension ${EXTENSION_ID} starting`);

  // Get core extension API
  const coreExtension = vscode.extensions.getExtension("konveyor.konveyor");
  if (!coreExtension) {
    const message = "Konveyor Go extension requires Konveyor Core extension to be installed";
    logger.error(message);
    vscode.window.showErrorMessage(message);
    return;
  }

  logger.info("Found Konveyor Core extension, activating...");

  let coreApi;
  try {
    coreApi = await coreExtension.activate();
  } catch (err) {
    const message = "Failed to activate Konveyor Core extension.";
    logger.error(message, err);
    vscode.window.showErrorMessage(message);
    return;
  }

  try {
    // Create and register Go language provider
    goProvider = new GoLanguageProvider(context);

    // Check for Go extension and runtime before registering
    goProvider.checkGoExtensionInstalled();
    await goProvider.checkGoRuntimeInstalled();

    // Register with core extension (this will start proxy server and external provider)
    await goProvider.register();

    // Register document change listeners for analysis triggers
    const documentWatcher = vscode.workspace.onDidSaveTextDocument((document) => {
      if (goProvider?.isFileSupported(document)) {
        logger.debug(`Go file saved: ${document.fileName}`);
        // TODO: Trigger analysis when provider registry is available
      }
    });

    context.subscriptions.push(documentWatcher);

    // Register commands (if any specific to Go extension)
    registerCommands(context);

    logger.info("Konveyor Go Extension activated successfully");
  } catch (error) {
    logger?.error("Failed to activate Konveyor Go Extension:", error);
    vscode.window.showErrorMessage(`Failed to activate Konveyor Go Extension: ${error}`);
    throw error;
  }
}

/**
 * Register Go-specific commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
  // Example command: Show Go provider info
  const showProviderInfoCommand = vscode.commands.registerCommand(
    "konveyor-go.showProviderInfo",
    () => {
      vscode.window.showInformationMessage(
        `Go Provider - Supports: ${goProviderConfig.supportedExtensions.join(", ")}`,
      );
    },
  );

  context.subscriptions.push(showProviderInfoCommand);
}

/**
 * Extension deactivation function
 */
export async function deactivate(): Promise<void> {
  logger?.info("Deactivating Konveyor Go Extension...");

  // Stop components in reverse order
  if (goProvider) {
    await goProvider.stopExternalProviderManager();
    await goProvider.stopProxyServer();
  }

  goProvider = undefined;
  logger?.info("Konveyor Go Extension deactivated");
}

// Export the provider class for testing
export { GoLanguageProvider };
