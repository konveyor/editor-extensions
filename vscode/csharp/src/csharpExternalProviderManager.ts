import * as vscode from "vscode";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import { Logger } from "winston";
import * as path from "path";
import * as fs from "fs";
import { platform, arch } from "process";

/**
 * C# External Provider Manager
 *
 * Manages the c-sharp-analyzer-provider subprocess lifecycle:
 * - Spawns the provider with GRPC socket
 * - Monitors the process
 * - Handles crashes and restarts
 */
export class CSharpExternalProviderManager implements vscode.Disposable {
  private process: ChildProcessWithoutNullStreams | null = null;
  private providerSocketPath: string;
  private disposed = false;

  constructor(
    providerSocketPath: string,
    private context: vscode.ExtensionContext,
    private logger: Logger,
  ) {
    this.providerSocketPath = providerSocketPath;
    this.logger = logger.child({ component: "CSharpExternalProviderManager" });
  }

  /**
   * Start the c-sharp-analyzer-provider subprocess
   */
  async start(): Promise<void> {
    if (this.process) {
      this.logger.info("c-sharp-analyzer-provider already running");
      return;
    }

    const binaryPath = this.getProviderBinaryPath();

    if (!fs.existsSync(binaryPath)) {
      const message = `c-sharp-analyzer-provider binary not found at ${binaryPath}`;
      this.logger.error(message);
      throw new Error(message);
    }

    this.logger.info(`Starting c-sharp-analyzer-provider`, {
      binaryPath,
      socket: this.providerSocketPath,
    });

    // Spawn the provider process with C#-specific args
    const args =
      platform === "win32"
        ? ["--socket", this.providerSocketPath] // Use named pipe on Windows
        : ["--socket", this.providerSocketPath]; // Use Unix socket on Unix-like systems

    this.process = spawn(binaryPath, args, {
      cwd: path.dirname(binaryPath),
    });

    // Log stdout
    this.process.stdout.on("data", (data) => {
      const message = data.toString().trimEnd();
      this.logger.info(`[c-sharp-analyzer-provider] ${message}`);
    });

    // Log stderr
    this.process.stderr.on("data", (data) => {
      const message = data.toString().trimEnd();
      this.logger.error(`[c-sharp-analyzer-provider] ${message}`);
    });

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      this.logger.info(`c-sharp-analyzer-provider exited`, { code, signal });

      if (!this.disposed && code !== 0) {
        this.logger.error(`c-sharp-analyzer-provider crashed with code ${code}`);
        vscode.window.showErrorMessage(
          `C# analyzer provider crashed (code: ${code}). Please check the logs.`,
        );
      }

      this.process = null;
    });

    // Handle process errors
    this.process.on("error", (err) => {
      this.logger.error("c-sharp-analyzer-provider process error", err);
      this.process = null;
      vscode.window.showErrorMessage(`Failed to start c-sharp-analyzer-provider: ${err.message}`);
    });

    this.logger.info(`c-sharp-analyzer-provider started with pid ${this.process.pid}`);
  }

  /**
   * Get the path to the c-sharp-analyzer-provider binary
   */
  private getProviderBinaryPath(): string {
    const packageJson = this.context.extension.packageJSON;
    const baseAssetPath =
      packageJson.includedAssetPaths?.csharpAnalyzerProvider ||
      "../../downloaded_assets/c-sharp-analyzer-provider";

    const platformArch = `${platform}-${arch}`;
    const binaryName =
      platform === "win32" ? "c-sharp-analyzer-provider-cli.exe" : "c-sharp-analyzer-provider-cli";

    const binaryPath = this.context.asAbsolutePath(
      path.join(baseAssetPath, platformArch, binaryName),
    );

    return binaryPath;
  }

  /**
   * Get the socket path where the provider is listening
   */
  getSocketPath(): string {
    return this.providerSocketPath;
  }

  /**
   * Stop the provider process
   */
  dispose(): void {
    this.disposed = true;

    if (this.process) {
      this.logger.info("Stopping c-sharp-analyzer-provider");
      this.process.kill();
      this.process = null;
    }
  }
}
