import * as vscode from "vscode";

import { ChildProcessWithoutNullStreams, spawn } from "child_process";

import { Logger } from "winston";

import * as path from "path";

import * as fs from "fs";

import { platform, arch } from "process";

/**
 * Go External Provider Manager
 *
 * Manages the go-external-provider subprocess lifecycle:
 * - Spawns the provider with GRPC socket
 * - Monitors the process
 * - Handles crashes and restarts
 */
export class GoExternalProviderManager implements vscode.Disposable {
  private process: ChildProcessWithoutNullStreams | null = null;

  private providerSocketPath: string;

  private disposed = false;

  constructor(
    providerSocketPath: string,
    private context: vscode.ExtensionContext,
    private logger: Logger,
  ) {
    this.providerSocketPath = providerSocketPath;

    this.logger = logger.child({ component: "GoExternalProviderManager" });
  }

  /**
   * Start the go-external-provider subprocess
   */
  async start(): Promise<void> {
    if (this.process) {
      this.logger.info("go-external-provider already running");
      return;
    }

    const binaryPath = this.getProviderBinaryPath();

    if (!fs.existsSync(binaryPath)) {
      const message = `go-external-provider binary not found at ${binaryPath}`;
      this.logger.error(message);
      throw new Error(message);
    }

    this.logger.info(`Starting go-external-provider`, {
      binaryPath,
      socket: this.providerSocketPath,
    });

    // Spawn the provider process
    this.process = spawn(binaryPath, ["-name", "go", "-socket", this.providerSocketPath], {
      cwd: path.dirname(binaryPath),
    });

    // Log stdout
    this.process.stdout.on("data", (data) => {
      const message = data.toString().trimEnd();
      this.logger.info(`[go-external-provider] ${message}`);
    });

    // Log stderr
    this.process.stderr.on("data", (data) => {
      const message = data.toString().trimEnd();
      this.logger.error(`[go-external-provider] ${message}`);
    });

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      this.logger.info(`go-external-provider exited`, { code, signal });

      if (!this.disposed && code !== 0) {
        this.logger.error(`go-external-provider crashed with code ${code}`);
        vscode.window.showErrorMessage(
          `Go external provider crashed (code: ${code}). Please check the logs.`,
        );
      }

      this.process = null;
    });

    // Handle process errors
    this.process.on("error", (err) => {
      this.logger.error("go-external-provider process error", err);
      vscode.window.showErrorMessage(`Failed to start go-external-provider: ${err.message}`);
    });

    this.logger.info(`go-external-provider started with pid ${this.process.pid}`);
  }

  /**
   * Get the path to the go-external-provider binary
   */
  private getProviderBinaryPath(): string {
    const packageJson = this.context.extension.packageJSON;

    const baseAssetPath =
      packageJson.includedAssetPaths?.genericExternalProvider ||
      "../../downloaded_assets/generic-external-provider";

    const platformArch = `${platform}-${arch}`;

    const binaryName =
      platform === "win32" ? "generic-external-provider.exe" : "generic-external-provider";

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
      this.logger.info("Stopping go-external-provider");
      this.process.kill();
      this.process = null;
    }
  }
}
