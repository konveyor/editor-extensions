import { HubConfig } from "@editor-extensions/shared";
import { Logger } from "winston";
import { SolutionServerClient } from "@editor-extensions/agentic";
import * as vscode from "vscode";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

// Callback type for workflow disposal
export type WorkflowDisposalCallback = () => void;

const TOKEN_EXPIRY_BUFFER_MS = 30000; // 30 second buffer
const REAUTH_DELAY_MS = 5000; // Delay before re-authentication attempt

export class HubConnectionManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubConnectionManagerError";
  }
}

/**
 * Manages Hub connection, authentication, and solution server client lifecycle.
 * Centralizes all Hub-related configuration and auth management.
 */
export class HubConnectionManager {
  private config: HubConfig;
  private logger: Logger;
  private solutionServerClient: SolutionServerClient | null = null;
  private onWorkflowDisposal?: WorkflowDisposalCallback;

  // Authentication state
  private bearerToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private username: string = "";
  private password: string = "";

  // Token refresh retry state
  private isRefreshingTokens: boolean = false;
  private refreshRetryCount: number = 0;

  // SSL bypass cleanup
  private sslBypassCleanup: (() => void) | null = null;

  constructor(defaultConfig: HubConfig, logger: Logger) {
    this.config = defaultConfig;
    this.logger = logger.child({
      component: "HubConnectionManager",
    });
  }

  /**
   * Set workflow disposal callback
   * This callback is invoked when the solution server client changes,
   * allowing the extension to dispose/reinitialize the workflow
   */
  public setWorkflowDisposalCallback(callback: WorkflowDisposalCallback): void {
    this.onWorkflowDisposal = callback;
  }

  /**
   * Initialize with Hub configuration and connect if enabled
   */
  public async initialize(config: HubConfig): Promise<void> {
    this.config = config;

    // Initialize auth state
    if (config.auth.enabled) {
      this.username = config.auth.username || "";
      this.password = config.auth.password || "";
    }

    // Connect if enabled
    if (config.enabled && config.features.solutionServer.enabled) {
      await this.connect();
    }

    this.logger.info("Hub connection manager initialized", {
      enabled: config.enabled,
      solutionServerEnabled: config.features.solutionServer.enabled,
      solutionServerConnected: this.isSolutionServerConnected(),
    });
  }

  /**
   * Update Hub configuration and reinitialize if needed
   */
  public async updateConfig(config: HubConfig): Promise<void> {
    // Determine if connection-related config changed
    const configChanged =
      this.config.url !== config.url ||
      this.config.enabled !== config.enabled ||
      this.config.auth.enabled !== config.auth.enabled ||
      this.config.auth.realm !== config.auth.realm ||
      this.config.auth.username !== config.auth.username ||
      this.config.auth.password !== config.auth.password ||
      this.config.features.solutionServer.enabled !== config.features.solutionServer.enabled;

    const wasConnected = this.isSolutionServerConnected();
    const shouldBeConnected = config.enabled && config.features.solutionServer.enabled;

    this.config = config;

    // Update credentials if auth is enabled
    if (config.auth.enabled) {
      this.username = config.auth.username || "";
      this.password = config.auth.password || "";
    } else {
      // Clear auth state if disabled
      this.username = "";
      this.password = "";
      this.bearerToken = null;
      this.refreshToken = null;
      this.tokenExpiresAt = null;
      this.clearTokenRefreshTimer();
    }

    this.logger.info("Hub configuration updated");

    // Determine if workflow should be disposed due to solution server client change
    const shouldDisposeWorkflow =
      (wasConnected && !shouldBeConnected) || // Disconnecting
      (wasConnected && shouldBeConnected && configChanged); // Reconnecting with new config

    // Handle connection state changes
    if (wasConnected && !shouldBeConnected) {
      // Should disconnect
      this.logger.info("Configuration change requires disconnection");
      await this.disconnect();
      vscode.window.showInformationMessage("Solution server disconnected");
    } else if (!wasConnected && shouldBeConnected) {
      // Should connect
      this.logger.info("Configuration change requires connection");
      await this.connect().catch((error) => {
        this.logger.error("Failed to connect after config update", error);
      });
      // Notify user about initial connection result
      if (this.isSolutionServerConnected()) {
        vscode.window.showInformationMessage("Successfully connected to solution server");
      } else {
        vscode.window.showWarningMessage(
          "Failed to connect to solution server. Check configuration and try again.",
        );
      }
    } else if (wasConnected && shouldBeConnected && configChanged) {
      // Should reconnect with new config
      this.logger.info("Configuration change requires reconnection");
      await this.disconnect();
      await this.connect().catch((error) => {
        this.logger.error("Failed to reconnect after config update", error);
      });
      // Notify user about reconnection result
      if (this.isSolutionServerConnected()) {
        vscode.window.showInformationMessage(
          "Successfully reconnected to solution server with new configuration",
        );
      } else {
        vscode.window.showWarningMessage(
          "Failed to reconnect to solution server. Check configuration and try again.",
        );
      }
    }

    // Notify extension to dispose workflow if solution server client changed
    // The callback will check if workflow is running and defer disposal if needed
    if (shouldDisposeWorkflow && this.onWorkflowDisposal) {
      this.logger.info("Solution server client changed, notifying workflow disposal callback");
      this.onWorkflowDisposal();
    }
  }

  /**
   * Get the solution server client if available
   * Returns undefined if Hub or solution server is disabled
   */
  public getSolutionServerClient(): SolutionServerClient | undefined {
    if (
      !this.config.enabled ||
      !this.config.features.solutionServer.enabled ||
      !this.solutionServerClient
    ) {
      return undefined;
    }
    return this.solutionServerClient;
  }

  /**
   * Check if solution server is connected
   * Returns true only if the solution server client is connected
   */
  public isSolutionServerConnected(): boolean {
    return this.solutionServerClient?.isConnected ?? false;
  }

  /**
   * Check if authentication is valid
   */
  public hasValidAuth(): boolean {
    if (!this.config.auth.enabled) {
      return true; // Auth not required
    }
    return !!this.bearerToken && (this.tokenExpiresAt ? this.tokenExpiresAt > Date.now() : false);
  }

  /**
   * Connect to Hub and initialize solution server client
   */
  public async connect(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info("Hub is disabled, skipping connection");
      return;
    }

    if (!this.config.features.solutionServer.enabled) {
      this.logger.info("Solution server is disabled, skipping connection");
      return;
    }

    // Apply SSL bypass for development/testing if insecure flag is enabled
    if (this.config.auth.insecure) {
      this.sslBypassCleanup = this.applySSLBypass();
    }

    // Handle authentication if required
    if (this.config.auth.enabled) {
      // Check credentials are available
      if (!this.username || !this.password) {
        throw new HubConnectionManagerError(
          "Authentication is enabled but credentials are not configured",
        );
      }

      // Exchange for tokens if we don't have one
      if (!this.bearerToken) {
        try {
          await this.exchangeForTokens();
        } catch (error) {
          this.logger.error("Failed to exchange for tokens", error);
          throw error;
        }
      }

      // Ensure refresh timer is running
      this.startTokenRefreshTimer();
    }

    // Create solution server client with current token
    this.solutionServerClient = new SolutionServerClient(
      this.config.url,
      this.bearerToken,
      this.logger,
    );

    // Connect the client
    try {
      await this.solutionServerClient.connect();
      this.logger.info("Successfully connected to Hub solution server");
    } catch (error) {
      this.logger.error("Failed to connect solution server client", error);
      // Clean up on connection failure
      this.solutionServerClient = null;
      throw error;
    }
  }

  /**
   * Disconnect from Hub and clean up resources
   */
  public async disconnect(): Promise<void> {
    this.logger.info("Disconnecting from Hub...");

    // Clear refresh timer
    this.clearTokenRefreshTimer();

    // Restore SSL settings
    if (this.sslBypassCleanup) {
      this.sslBypassCleanup();
      this.sslBypassCleanup = null;
    }

    // Disconnect solution server client
    if (this.solutionServerClient) {
      try {
        await this.solutionServerClient.disconnect();
      } catch (error) {
        this.logger.error("Error disconnecting solution server client", error);
      } finally {
        this.solutionServerClient = null;
      }
    }

    this.logger.info("Disconnected from Hub");
  }

  /**
   * Exchange credentials for OAuth tokens
   */
  private async exchangeForTokens(): Promise<void> {
    if (!this.username || !this.password) {
      throw new HubConnectionManagerError("No username or password available for token exchange");
    }

    const url = new URL(this.config.url);
    const keycloakUrl = `${url.protocol}//${url.host}/auth`;
    const tokenUrl = `${keycloakUrl}/realms/${this.config.auth.realm}/protocol/openid-connect/token`;
    const clientId = `${this.config.auth.realm}-ui`;

    const params = new URLSearchParams();
    params.append("grant_type", "password");
    params.append("client_id", clientId);
    params.append("username", this.username);
    params.append("password", this.password);

    try {
      this.logger.debug(`Attempting token exchange with ${tokenUrl}`);

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Token exchange failed: ${response.status} ${response.statusText}`,
          errorText,
        );
        throw new HubConnectionManagerError(
          `Authentication failed: ${response.status} ${response.statusText}`,
        );
      }

      const tokenResponse = (await response.json()) as TokenResponse;
      this.logger.info("Token exchange successful");

      this.bearerToken = tokenResponse.access_token;
      this.refreshToken = tokenResponse.refresh_token || null;
      this.tokenExpiresAt = Date.now() + tokenResponse.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;
    } catch (error) {
      this.logger.error("Token exchange failed", error);
      if (error instanceof HubConnectionManagerError) {
        throw error;
      }
      throw new HubConnectionManagerError(
        `Token exchange failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Refresh OAuth tokens using refresh token
   */
  private async refreshTokens(): Promise<void> {
    if (!this.refreshToken) {
      this.logger.warn("No refresh token available, cannot refresh");
      return;
    }

    if (this.isRefreshingTokens) {
      this.logger.debug("Token refresh already in progress");
      return;
    }

    // Retry configuration
    const maxRefreshRetries = 3;
    const baseRetryDelayMs = 1000; // Start with 1 second

    // Cancel any pending timers to avoid overlapping refreshes
    this.clearTokenRefreshTimer();
    this.isRefreshingTokens = true;

    const url = new URL(this.config.url);
    const keycloakUrl = `${url.protocol}//${url.host}/auth`;
    const tokenUrl = `${keycloakUrl}/realms/${this.config.auth.realm}/protocol/openid-connect/token`;
    const clientId = `${this.config.auth.realm}-ui`;

    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("client_id", clientId);
    params.append("refresh_token", this.refreshToken);

    try {
      this.logger.debug(`Attempting token refresh with ${tokenUrl}`);

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Token refresh failed: ${response.status} ${response.statusText}`,
          errorText,
        );
        throw new HubConnectionManagerError(
          `Token refresh failed: ${response.status} ${response.statusText}`,
        );
      }

      const tokenResponse = (await response.json()) as TokenResponse;
      this.logger.info("Token refresh successful");

      this.bearerToken = tokenResponse.access_token;
      this.refreshToken = tokenResponse.refresh_token || this.refreshToken;
      this.tokenExpiresAt = Date.now() + tokenResponse.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;

      // Reconnect solution server with new token
      if (this.isSolutionServerConnected() && this.solutionServerClient) {
        this.logger.info("Reconnecting solution server with new token");
        try {
          await this.disconnect();
          await this.connect();
        } catch (error) {
          this.logger.error("Error reconnecting solution server after token refresh", error);
        }
      }

      // Success - reset retry counter and start normal timer
      this.refreshRetryCount = 0;
      this.startTokenRefreshTimer();
    } catch (error) {
      this.logger.error("Token refresh failed", error);

      // Determine if error is retryable
      const isRetryable = this.isRetryableRefreshError(error);

      if (isRetryable && this.refreshRetryCount < maxRefreshRetries) {
        this.refreshRetryCount++;
        const delayMs = baseRetryDelayMs * Math.pow(2, this.refreshRetryCount - 1);

        this.logger.warn(
          `Token refresh failed (attempt ${this.refreshRetryCount}/${maxRefreshRetries}), retrying in ${delayMs}ms`,
        );

        // Schedule retry with exponential backoff
        this.refreshTimer = setTimeout(() => {
          this.refreshTokens().catch((error) => {
            this.logger.error("Retry token refresh failed", error);
          });
        }, delayMs);
      } else {
        // Non-retryable error or max retries exceeded
        this.refreshRetryCount = 0;
        this.logger.error(
          `Token refresh failed permanently: ${isRetryable ? "max retries exceeded" : "non-retryable error"}`,
        );

        // Clear the refresh timer to break any potential retry loops
        this.clearTokenRefreshTimer();

        // Clear the invalid tokens
        this.bearerToken = null;
        this.refreshToken = null;
        this.tokenExpiresAt = null;

        // Attempt full re-authentication if credentials are available
        if (this.username && this.password) {
          this.logger.info(
            `Attempting full re-authentication after permanent refresh failure in ${REAUTH_DELAY_MS}ms`,
          );
          this.refreshTimer = setTimeout(() => {
            this.exchangeForTokens()
              .then(async () => {
                this.logger.info("Re-authentication successful, reconnecting...");
                if (this.isSolutionServerConnected()) {
                  await this.disconnect();
                }
                await this.connect();
              })
              .catch((error) => {
                this.logger.error("Re-authentication failed after token refresh failure", error);
              });
          }, REAUTH_DELAY_MS);
        } else {
          this.logger.error(
            "Cannot recover from token refresh failure: no credentials available for re-authentication",
          );
        }
      }
    } finally {
      this.isRefreshingTokens = false;
    }
  }

  /**
   * Start automatic token refresh timer
   */
  private startTokenRefreshTimer(): void {
    this.clearTokenRefreshTimer();

    if (!this.tokenExpiresAt) {
      this.logger.warn("No token expiration time available, cannot start refresh timer");
      return;
    }

    const now = Date.now();
    const timeUntilRefresh = this.tokenExpiresAt - now;

    if (timeUntilRefresh <= 0) {
      // Token already expired, refresh immediately
      this.refreshTokens().catch((error) => {
        this.logger.error("Immediate token refresh failed", error);
      });
      return;
    }

    this.logger.info(`Starting token refresh timer, will refresh in ${timeUntilRefresh}ms`);
    this.refreshTimer = setTimeout(() => {
      this.refreshTokens().catch((error) => {
        this.logger.error("Token refresh timer failed", error);
      });
    }, timeUntilRefresh);
  }

  /**
   * Clear token refresh timer
   */
  private clearTokenRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /**
   * Check if a token refresh error is retryable
   */
  private isRetryableRefreshError(error: any): boolean {
    if (error instanceof HubConnectionManagerError) {
      // Check if it's an HTTP 400/401 (bad/expired refresh token)
      const message = error.message.toLowerCase();
      if (
        message.includes("400") ||
        message.includes("401") ||
        message.includes("invalid_grant") ||
        message.includes("unauthorized")
      ) {
        return false; // Non-retryable - token is likely permanently invalid
      }
    }

    // Network errors, 5xx server errors, timeouts are retryable
    return true;
  }

  /**
   * Apply SSL bypass for insecure connections (Node.js specific)
   */
  private applySSLBypass(): () => void {
    this.logger.debug("Applying SSL bypass for insecure connections");

    // Store original values
    const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    // Disable SSL verification through environment variable
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    this.logger.warn("SSL certificate verification is disabled");

    // Return cleanup function
    return () => {
      this.logger.debug("Restoring SSL settings");
      if (originalRejectUnauthorized !== undefined) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized;
      } else {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      }
    };
  }
}
