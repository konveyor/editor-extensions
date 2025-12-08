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

// Callback type for workflow disposal
export type WorkflowDisposalCallback = () => void;

// Callback type for token refresh (to update model provider)
export type TokenRefreshCallback = (newToken: string) => void;

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
  private onTokenRefresh?: TokenRefreshCallback;

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
   * Set token refresh callback
   */
  public setTokenRefreshCallback(callback: TokenRefreshCallback): void {
    this.onTokenRefresh = callback;
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
    this.onWorkflowDisposal?.();
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
        this.startTokenRefreshTimer();

        // Notify listeners that we have a (possibly new) bearer token.
        // This ensures downstream model providers are rebuilt after reconnects,
        // not just after token refresh events.
        if (this.bearerToken) {
          this.onTokenRefresh?.(this.bearerToken);
        }
      } catch (error) {
        this.logger.error("Authentication failed", error);
        return; // Can't proceed without auth
      }
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
        vscode.window.showWarningMessage("Failed to connect to Hub solution server");
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
        vscode.window.showWarningMessage("Failed to connect to Hub profile sync");
        this.profileSyncClient = null;
        // Continue - profile sync is optional
      }
    }
  }

  /**
   * Disconnect from Hub and clean up all resources
   */
  public async disconnect(): Promise<void> {
    this.logger.info("Disconnecting from Hub...");

    // Clear all timers
    this.clearTokenRefreshTimer();
    this.clearProfileSyncTimer();

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

    // Restore SSL settings
    if (this.sslBypassCleanup) {
      this.sslBypassCleanup();
      this.sslBypassCleanup = null;
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

    this.logger.debug(`Attempting token exchange with ${tokenUrl}`);

    const tokenResponse = await this.fetchWithTimeout<TokenResponse>(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params,
    });

    this.logger.info("Token exchange successful");
    this.bearerToken = tokenResponse.access_token;
    this.refreshToken = tokenResponse.refresh_token || null;
    this.tokenExpiresAt = Date.now() + tokenResponse.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;
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

    this.clearTokenRefreshTimer();
    this.isRefreshingTokens = true;

    try {
      await this.performTokenRefresh();

      // Success - reconnect with new token
      this.refreshRetryCount = 0;
      await this.connect();

      // Notify callbacks
      if (this.bearerToken) {
        this.onTokenRefresh?.(this.bearerToken);
      }
    } catch (error) {
      await this.handleTokenRefreshError(error);
    } finally {
      this.isRefreshingTokens = false;
    }
  }

  /**
   * Perform the actual token refresh request
   */
  private async performTokenRefresh(): Promise<void> {
    const url = new URL(this.config.url);
    const keycloakUrl = `${url.protocol}//${url.host}/auth`;
    const tokenUrl = `${keycloakUrl}/realms/${this.config.auth.realm}/protocol/openid-connect/token`;
    const clientId = `${this.config.auth.realm}-ui`;

    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("client_id", clientId);
    params.append("refresh_token", this.refreshToken!);

    this.logger.debug(`Attempting token refresh with ${tokenUrl}`);

    const tokenResponse = await this.fetchWithTimeout<TokenResponse>(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params,
    });

    this.logger.info("Token refresh successful");
    this.bearerToken = tokenResponse.access_token;
    this.refreshToken = tokenResponse.refresh_token || this.refreshToken;
    this.tokenExpiresAt = Date.now() + tokenResponse.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;
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
      // Permanent failure - attempt full re-authentication
      this.refreshRetryCount = 0;
      this.logger.error(
        `Token refresh failed permanently: ${isRetryable ? "max retries exceeded" : "non-retryable error"}`,
      );

      this.bearerToken = null;
      this.refreshToken = null;
      this.tokenExpiresAt = null;

      if (this.username && this.password) {
        this.logger.info(`Attempting full re-authentication in ${REAUTH_DELAY_MS}ms`);
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
  private startTokenRefreshTimer(): void {
    this.clearTokenRefreshTimer();

    if (!this.tokenExpiresAt) {
      this.logger.warn("No token expiration time available, cannot start refresh timer");
      return;
    }

    const timeUntilRefresh = this.tokenExpiresAt - Date.now();

    if (timeUntilRefresh <= 0) {
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
