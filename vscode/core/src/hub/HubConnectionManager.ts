import { HubConfig } from "@editor-extensions/shared";
import { Logger } from "winston";
import { SolutionServerClient } from "@editor-extensions/agentic";
import { ProfileSyncClient, type LLMProxyConfig } from "../clients/ProfileSyncClient";
import * as vscode from "vscode";
import { executeExtensionCommand } from "../commands";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

// Hub login endpoint response format
export interface HubLoginResponse {
  user?: string;
  token: string;
  refresh?: string; // Refresh token (field name is "refresh")
  expiry?: number; // Seconds until expiry (NOT Unix timestamp)
}

// Callback type for workflow disposal (called after successful connection)
export type WorkflowDisposalCallback = () => void;

// Callback type for profile sync (to trigger automatic sync)
export type ProfileSyncCallback = () => Promise<void>;

const TOKEN_EXPIRY_BUFFER_MS = 30000; // 30 second buffer
const REAUTH_DELAY_MS = 5000; // Delay before re-authentication attempt
const PROFILE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_EXCHANGE_TIMEOUT_MS = 30000; // 30 second timeout for token exchange

export class HubConnectionManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HubConnectionManagerError";
  }
}

/**
 * Manages Hub connection, authentication, and client lifecycle.
 */
export class HubConnectionManager {
  private config: HubConfig;
  private logger: Logger;
  private solutionServerClient: SolutionServerClient | null = null;
  private profileSyncClient: ProfileSyncClient | null = null;
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

  // Profile sync state
  private profileSyncTimer: NodeJS.Timeout | null = null;

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
   */
  public setWorkflowDisposalCallback(callback: WorkflowDisposalCallback): void {
    this.onWorkflowDisposal = callback;
  }

  /**
   * Initialize with Hub configuration and connect if enabled
   */
  public async initialize(config: HubConfig): Promise<void> {
    this.config = config;
    this.updateCredentials(config);

    if (config.enabled) {
      await this.connect();
    }

    this.logger.info("Hub connection manager initialized", {
      enabled: config.enabled,
      solutionServerEnabled: config.features.solutionServer.enabled,
      solutionServerConnected: this.isSolutionServerConnected(),
      profileSyncEnabled: config.features.profileSync.enabled,
      profileSyncConnected: this.isProfileSyncConnected(),
    });
  }

  /**
   * Update Hub configuration and reconnect
   */
  public async updateConfig(config: HubConfig): Promise<void> {
    const wasEnabled = this.config.enabled;

    this.config = config;
    this.updateCredentials(config);

    this.logger.info("Hub configuration updated", {
      enabled: config.enabled,
      wasEnabled,
    });

    await this.connect();
  }

  /**
   * Get the solution server client if available
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
   * Get the profile sync client if available
   */
  public getProfileSyncClient(): ProfileSyncClient | undefined {
    if (
      !this.config.enabled ||
      !this.config.features.profileSync.enabled ||
      !this.profileSyncClient
    ) {
      return undefined;
    }
    return this.profileSyncClient;
  }

  /**
   * Get LLM proxy configuration if available
   */
  public getLLMProxyConfig(): LLMProxyConfig | undefined {
    return this.profileSyncClient?.getLLMProxyConfig();
  }

  /**
   * Get bearer token for Hub authentication
   */
  public getBearerToken(): string | null {
    return this.bearerToken;
  }

  /**
   * Check if solution server is connected
   */
  public isSolutionServerConnected(): boolean {
    return this.solutionServerClient?.isConnected ?? false;
  }

  /**
   * Check if profile sync is connected
   */
  public isProfileSyncConnected(): boolean {
    return this.profileSyncClient?.isConnected ?? false;
  }

  /**
   * Check if authentication is valid
   */
  public hasValidAuth(): boolean {
    if (!this.config.auth.enabled) {
      return true;
    }
    return !!this.bearerToken && (this.tokenExpiresAt ? this.tokenExpiresAt > Date.now() : false);
  }

  /**
   * Connect to Hub (idempotent)
   *
   * Always disconnects first, then connects enabled features with current config/token.
   * Safe to call anytime - handles initial connection, reconnection, and config changes.
   */
  public async connect(): Promise<void> {
    // Always disconnect first (idempotent - no-op if nothing connected)
    await this.disconnect();

    if (!this.config.enabled) {
      this.logger.info("Hub is disabled, skipping connection");
      return;
    }

    this.logger.info("Connecting to Hub...", {
      solutionServerEnabled: this.config.features.solutionServer.enabled,
      profileSyncEnabled: this.config.features.profileSync.enabled,
    });

    // Apply SSL bypass if needed
    if (this.config.auth.insecure) {
      this.sslBypassCleanup = this.applySSLBypass();
    }

    // Handle authentication
    if (this.config.auth.enabled) {
      try {
        await this.ensureAuthenticated();
        await this.startTokenRefreshTimer();
      } catch (error) {
        this.logger.error("Authentication failed", error);

        // Extract meaningful error message and show to user
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          `Failed to authenticate with Hub: ${errorMessage}, check your username and password.`,
        );

        return; // Can't proceed without auth
      }
    }

    // Verify Hub connectivity and auth before connecting individual features
    // This catches cases where auth is disabled in config but Hub requires it
    try {
      this.logger.info("Verifying Hub connectivity and authentication");
      const testClient = new ProfileSyncClient(this.config.url, this.bearerToken, this.logger);
      await testClient.connect();
      await testClient.disconnect();
      this.logger.info("Hub connectivity check passed");
    } catch (error) {
      this.logger.error("Hub connectivity check failed", error);

      // Extract meaningful error message
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Show specific error to user - this is a blocker for all features
      vscode.window.showErrorMessage(
        `Failed to connect to Hub: ${errorMessage}, check your URL and credentials.`,
      );

      return; // Can't proceed if we can't connect to Hub
    }

    // Connect Solution Server
    if (this.config.features.solutionServer.enabled) {
      try {
        this.logger.info("Connecting solution server client", { hubUrl: this.config.url });
        this.solutionServerClient = new SolutionServerClient(
          this.config.url,
          this.bearerToken,
          this.logger,
        );
        await this.solutionServerClient.connect();
        this.logger.info("Successfully connected to Hub solution server");
        vscode.window.showInformationMessage("Successfully connected to Hub solution server");
      } catch (error) {
        this.logger.error("Failed to connect solution server client", error);

        // Extract meaningful error message
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Show specific error to user
        vscode.window.showErrorMessage(`Failed to connect to Hub solution server: ${errorMessage}`);

        this.solutionServerClient = null;
        // Continue - solution server is optional
      }
    }

    // Connect Profile Sync
    if (this.config.features.profileSync.enabled) {
      try {
        this.logger.info("Connecting profile sync client");
        this.profileSyncClient = new ProfileSyncClient(
          this.config.url,
          this.bearerToken,
          this.logger,
        );
        await this.profileSyncClient.connect();
        this.logger.info("Successfully connected to Hub profile sync");
        vscode.window.showInformationMessage("Successfully connected to Hub profile sync");

        // Log LLM proxy status
        const llmProxyConfig = this.profileSyncClient.getLLMProxyConfig();
        if (llmProxyConfig) {
          this.logger.info("LLM proxy available", { endpoint: llmProxyConfig.endpoint });
        }

        // Trigger initial sync and start timer
        this.triggerProfileSync();
        this.startProfileSyncTimer();
      } catch (error) {
        this.logger.error("Failed to connect profile sync client", error);

        // Extract meaningful error message
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Show specific error to user
        vscode.window.showErrorMessage(`Failed to connect to Hub profile sync: ${errorMessage}`);

        this.profileSyncClient = null;
        // Continue - profile sync is optional
      }
    }

    // Notify workflow disposal callback after successful connection
    // This handles both workflow disposal and model provider updates
    this.onWorkflowDisposal?.();
  }

  /**
   * Disconnect from Hub and clean up all resources
   */
  public async disconnect(): Promise<void> {
    if (!this.solutionServerClient && !this.profileSyncClient) {
      this.logger.silly("No Hub features connected, skipping disconnect");
      return;
    }

    this.logger.info("Disconnecting from Hub...");

    // Disconnect solution server
    if (this.solutionServerClient) {
      try {
        await this.solutionServerClient.disconnect();
      } catch (error) {
        this.logger.error("Error disconnecting solution server client", error);
      }
      this.solutionServerClient = null;
    }

    // Disconnect profile sync
    if (this.profileSyncClient) {
      try {
        await this.profileSyncClient.disconnect();
      } catch (error) {
        this.logger.error("Error disconnecting profile sync client", error);
      }
      this.profileSyncClient = null;
    }

    // Only clear auth/timers/SSL if we're NOT in the middle of a token refresh
    // During refresh, we want to keep the fresh tokens and reconnect with them
    if (!this.isRefreshingTokens) {
      // Clear all timers
      this.clearTokenRefreshTimer();
      this.clearProfileSyncTimer();

      // Clear auth tokens - important when switching to a different Hub
      this.bearerToken = null;
      this.refreshToken = null;
      this.tokenExpiresAt = null;

      // Restore SSL settings
      if (this.sslBypassCleanup) {
        this.sslBypassCleanup();
        this.sslBypassCleanup = null;
      }
    }

    this.logger.info("Disconnected from Hub");
  }

  /**
   * Update stored credentials from config
   */
  private updateCredentials(config: HubConfig): void {
    if (config.auth.enabled) {
      this.username = config.auth.username || "";
      this.password = config.auth.password || "";
    } else {
      this.username = "";
      this.password = "";
      this.bearerToken = null;
      this.refreshToken = null;
      this.tokenExpiresAt = null;
    }
  }

  /**
   * Ensure we have a valid authentication token
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.username || !this.password) {
      throw new HubConnectionManagerError(
        "Authentication is enabled but credentials are not configured",
      );
    }

    if (!this.hasValidAuth()) {
      await this.exchangeForTokens();
    }
  }

  /**
   * Exchange credentials for tokens via Hub login endpoint.
   * Uses /hub/auth/login instead of direct Keycloak to get tokens that work with the LLM proxy.
   */
  private async exchangeForTokens(): Promise<void> {
    if (!this.username || !this.password) {
      throw new HubConnectionManagerError("No username or password available for token exchange");
    }

    const loginUrl = `${this.config.url}/hub/auth/login`;

    this.logger.debug(`Attempting token exchange with ${loginUrl}`);

    const loginResponse = await this.fetchWithTimeout<HubLoginResponse>(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        user: this.username,
        password: this.password,
      }),
    });

    this.logger.info("Token exchange successful via Hub login");
    this.bearerToken = loginResponse.token;
    this.refreshToken = loginResponse.refresh ?? null; // Store refresh token if provided

    // Get expiration from response or decode from JWT
    if (loginResponse.expiry) {
      // expiry is in SECONDS (not Unix timestamp), convert to milliseconds
      this.tokenExpiresAt = Date.now() + loginResponse.expiry * 1000 - TOKEN_EXPIRY_BUFFER_MS;
    } else {
      this.tokenExpiresAt = this.getExpirationFromJWT(loginResponse.token);
    }
  }

  /**
   * Refresh tokens using the refresh token via /hub/auth/refresh endpoint.
   * This is more efficient than re-authenticating with credentials.
   */
  private async refreshWithRefreshToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new HubConnectionManagerError("No refresh token available");
    }

    const refreshUrl = `${this.config.url}/hub/auth/refresh`;

    this.logger.debug(`Attempting token refresh with ${refreshUrl}`);

    const refreshResponse = await this.fetchWithTimeout<HubLoginResponse>(refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        refresh: this.refreshToken,
      }),
    });

    this.logger.info("Token refresh successful via Hub refresh endpoint");

    // Update tokens
    this.bearerToken = refreshResponse.token;
    this.refreshToken = refreshResponse.refresh ?? this.refreshToken; // Use new refresh token if provided

    // Get expiration from response or decode from JWT
    if (refreshResponse.expiry) {
      this.tokenExpiresAt = Date.now() + refreshResponse.expiry * 1000 - TOKEN_EXPIRY_BUFFER_MS;
    } else {
      this.tokenExpiresAt = this.getExpirationFromJWT(refreshResponse.token);
    }
  }

  /**
   * Extract expiration time from JWT token payload
   */
  private getExpirationFromJWT(token: string): number | null {
    try {
      const payload = token.split(".")[1];
      const decoded = JSON.parse(Buffer.from(payload, "base64").toString());
      if (decoded.exp) {
        return decoded.exp * 1000 - TOKEN_EXPIRY_BUFFER_MS;
      }
    } catch {
      this.logger.warn("Could not decode JWT expiration");
    }
    return null;
  }

  /**
   * Refresh tokens using refresh token if available, otherwise re-authenticate.
   */
  private async refreshTokens(): Promise<void> {
    if (this.isRefreshingTokens) {
      this.logger.debug("Token refresh already in progress");
      return;
    }

    this.clearTokenRefreshTimer();
    this.isRefreshingTokens = true;

    try {
      // Try refresh token first (more efficient)
      if (this.refreshToken) {
        this.logger.debug("Attempting token refresh with refresh token");
        try {
          await this.refreshWithRefreshToken();
          this.logger.info("Token refresh successful using refresh token");
        } catch (refreshError) {
          this.logger.warn("Refresh token failed, falling back to re-authentication", refreshError);
          this.refreshToken = null; // Clear invalid refresh token

          // Fall back to re-authentication
          if (!this.username || !this.password) {
            throw new HubConnectionManagerError(
              "Refresh token failed and no credentials available for re-authentication",
            );
          }
          await this.exchangeForTokens();
          this.logger.info("Re-authentication successful after refresh token failure");
        }
      } else {
        // No refresh token, re-authenticate
        this.logger.debug("No refresh token available, re-authenticating with credentials");
        if (!this.username || !this.password) {
          throw new HubConnectionManagerError("No credentials available for token refresh");
        }
        await this.exchangeForTokens();
        this.logger.info("Re-authentication successful");
      }

      // Success - reconnect with new token
      this.refreshRetryCount = 0;
      await this.connect();
    } catch (error) {
      await this.handleTokenRefreshError(error);
    } finally {
      this.isRefreshingTokens = false;
    }
  }

  /**
   * Handle token refresh errors with retry logic
   */
  private async handleTokenRefreshError(error: unknown): Promise<void> {
    this.logger.error("Token refresh failed", error);

    const maxRefreshRetries = 3;
    const baseRetryDelayMs = 1000;
    const isRetryable = this.isRetryableRefreshError(error);

    if (isRetryable && this.refreshRetryCount < maxRefreshRetries) {
      this.refreshRetryCount++;
      const delayMs = baseRetryDelayMs * Math.pow(2, this.refreshRetryCount - 1);

      this.logger.warn(
        `Token refresh failed (attempt ${this.refreshRetryCount}/${maxRefreshRetries}), retrying in ${delayMs}ms`,
      );

      this.refreshTimer = setTimeout(() => {
        this.refreshTokens().catch((err) => {
          this.logger.error("Retry token refresh failed", err);
        });
      }, delayMs);
    } else {
      // Permanent failure - clear tokens and schedule reconnection attempt
      this.refreshRetryCount = 0;
      this.logger.error(
        `Token refresh failed permanently: ${isRetryable ? "max retries exceeded" : "non-retryable error"}`,
      );

      this.bearerToken = null;
      this.tokenExpiresAt = null;

      if (this.username && this.password) {
        this.logger.info(`Attempting re-authentication in ${REAUTH_DELAY_MS}ms`);
        this.refreshTimer = setTimeout(() => {
          this.connect().catch((err) => {
            this.logger.error("Re-authentication failed", err);
          });
        }, REAUTH_DELAY_MS);
      }
    }
  }

  /**
   * Start automatic token refresh timer
   */
  private async startTokenRefreshTimer(): Promise<void> {
    this.clearTokenRefreshTimer();

    if (!this.tokenExpiresAt) {
      this.logger.warn("No token expiration time available, cannot start refresh timer");
      return;
    }

    const timeUntilRefresh = this.tokenExpiresAt - Date.now();

    if (timeUntilRefresh <= 0) {
      await this.refreshTokens().catch((error) => {
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
  private isRetryableRefreshError(error: unknown): boolean {
    if (error instanceof HubConnectionManagerError) {
      const message = error.message.toLowerCase();
      if (
        message.includes("400") ||
        message.includes("401") ||
        message.includes("invalid_grant") ||
        message.includes("unauthorized")
      ) {
        return false;
      }
    }
    return true;
  }

  /**
   * Trigger profile sync via callback
   */
  private triggerProfileSync(): void {
    executeExtensionCommand("syncHubProfiles", true);
  }

  /**
   * Start automatic profile sync timer
   */
  private startProfileSyncTimer(): void {
    this.clearProfileSyncTimer();

    this.logger.info(
      `Starting profile sync timer, will sync every ${PROFILE_SYNC_INTERVAL_MS / 1000}s`,
    );

    this.profileSyncTimer = setInterval(() => {
      if (this.isRefreshingTokens) {
        this.logger.debug("Skipping periodic profile sync - token refresh in progress");
        return;
      }
      this.triggerProfileSync();
    }, PROFILE_SYNC_INTERVAL_MS);
  }

  /**
   * Clear profile sync timer
   */
  private clearProfileSyncTimer(): void {
    if (this.profileSyncTimer) {
      clearInterval(this.profileSyncTimer);
      this.profileSyncTimer = null;
    }
  }

  /**
   * Fetch with timeout and error handling
   */
  private async fetchWithTimeout<T>(url: string, options: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TOKEN_EXCHANGE_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Request failed: ${response.status} ${response.statusText}`, errorText);
        throw new HubConnectionManagerError(
          `Request failed: ${response.status} ${response.statusText}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === "AbortError") {
        throw new HubConnectionManagerError(
          `Request timed out after ${TOKEN_EXCHANGE_TIMEOUT_MS / 1000} seconds`,
        );
      }

      if (error instanceof HubConnectionManagerError) {
        throw error;
      }

      throw new HubConnectionManagerError(
        `Request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Apply SSL bypass for insecure connections
   */
  private applySSLBypass(): () => void {
    this.logger.debug("Applying SSL bypass for insecure connections");
    const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    this.logger.warn("SSL certificate verification is disabled");

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
