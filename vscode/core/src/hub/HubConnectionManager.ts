import { HubConfig } from "@editor-extensions/shared";
import { Logger } from "winston";
import { SolutionServerClient } from "@editor-extensions/agentic";
import { ProfileSyncClient, type LLMProxyConfig } from "../clients/ProfileSyncClient";
import * as vscode from "vscode";
import { executeExtensionCommand } from "../commands";
import { getDispatcherWithCertBundle, getFetchWithDispatcher } from "../utilities/tls";
import {
  classifyNetworkError,
  classifyHttpStatus,
  sanitizeUrl,
} from "../utilities/networkDiagnostics";
import { OIDCDeviceFlowAuth, OIDCTokens } from "./OIDCDeviceFlowAuth";
import { OIDCAuthCodeFlow } from "./OIDCAuthCodeFlow";
import { OIDCTokenStorage } from "./OIDCTokenStorage";

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

/** Authentication method for Hub connection. */
export type HubAuthMethod = "oidc" | "oidc-auth-code" | "credentials";

// Callback type for workflow disposal (called after successful connection)
export type WorkflowDisposalCallback = (tokenRefreshOnly?: boolean) => void;

// Callback type for profile sync (to trigger automatic sync)
export type ProfileSyncCallback = () => Promise<void>;

const TOKEN_EXPIRY_BUFFER_MS = 30000; // 30 second buffer
const REAUTH_DELAY_MS = 5000; // Delay before re-authentication attempt
const PROFILE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_EXCHANGE_TIMEOUT_MS = 30000; // 30 second timeout for token exchange
const DEFAULT_OIDC_CLIENT_ID = "kai-ide";

export class HubConnectionManagerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HubConnectionManagerError";
  }
}

/**
 * Manages Hub connection, authentication, and client lifecycle.
 *
 * Supports three authentication methods:
 * - **OIDC Auth Code + PKCE** (default): Uses authorization code flow with PKCE.
 *   Opens browser for auth, catches callback via VS Code URI handler.
 * - **OIDC Device Flow**: Uses RFC 8628 device authorization grant.
 *   Fallback when device_code grant is available on the client.
 * - **Credentials** (legacy): Username/password via /hub/auth/login endpoint.
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

  // OIDC Auth Code Flow state (primary)
  private oidcAuthCode: OIDCAuthCodeFlow | null = null;

  // OIDC Device Flow state (fallback)
  private oidcAuth: OIDCDeviceFlowAuth | null = null;

  // Shared OIDC state
  private oidcTokenStorage: OIDCTokenStorage | null = null;
  private extensionContext: vscode.ExtensionContext | null = null;

  // Token refresh retry state
  private isRefreshingTokens: boolean = false;
  private refreshRetryCount: number = 0;

  // Profile sync state
  private profileSyncTimer: NodeJS.Timeout | null = null;

  // Connection-scoped fetch for insecure Hub connections
  private scopedFetch: typeof fetch | null = null;

  constructor(defaultConfig: HubConfig, logger: Logger) {
    this.config = defaultConfig;
    this.logger = logger.child({
      component: "HubConnectionManager",
    });
  }

  /**
   * Set VS Code extension context (needed for OIDC SecretStorage and URI handler).
   * Must be called before initialize() if using OIDC auth.
   */
  public setExtensionContext(context: vscode.ExtensionContext): void {
    this.extensionContext = context;
  }

  /**
   * Set workflow disposal callback
   */
  public setWorkflowDisposalCallback(callback: WorkflowDisposalCallback): void {
    this.onWorkflowDisposal = callback;
  }

  /**
   * Get the current authentication method based on config.
   * Defaults to "oidc-auth-code" (authorization code + PKCE flow).
   */
  public getAuthMethod(): HubAuthMethod {
    const method = this.config.auth.method;
    if (method === "credentials") {
      return "credentials";
    }
    // Default to auth code flow. "oidc" in config means auth-code primary,
    // device flow as fallback.
    return "oidc-auth-code";
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
      authMethod: this.getAuthMethod(),
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
      authMethod: this.getAuthMethod(),
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
   * Get the connection-scoped fetch function for Hub TLS configuration.
   * Returns the custom fetch if insecure mode is enabled, otherwise undefined.
   * Used to propagate Hub TLS settings to LLM proxy model providers.
   */
  public getScopedFetch(): typeof fetch | undefined {
    return this.scopedFetch ?? undefined;
  }

  /**
   * Check if authentication is enabled in the Hub configuration
   */
  public isAuthEnabled(): boolean {
    return this.config.auth.enabled ?? false;
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

  public isLLMProxyConnected(): boolean {
    return this.profileSyncClient?.getLLMProxyConfig()?.available ?? false;
  }

  /**
   * Check if authentication is valid
   */
  public hasValidAuth(): boolean {
    if (!this.config.auth.enabled) {
      return true;
    }

    const method = this.getAuthMethod();

    // Auth Code flow: check via the auth client
    if (method === "oidc-auth-code" && this.oidcAuthCode) {
      return this.oidcAuthCode.isTokenValid();
    }

    // Device flow: check via the auth client
    if (method === "oidc" && this.oidcAuth) {
      return this.oidcAuth.isTokenValid();
    }

    // Credentials: check bearer token directly
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
      url: sanitizeUrl(this.config.url),
      authEnabled: this.config.auth.enabled,
      authMethod: this.getAuthMethod(),
      insecure: this.config.auth.insecure,
      hasCredentials: !!(this.username && this.password),
      solutionServerEnabled: this.config.features.solutionServer.enabled,
      profileSyncEnabled: this.config.features.profileSync.enabled,
    });

    // Create connection-scoped fetch for insecure mode
    if (this.config.auth.insecure) {
      this.logger.warn("SSL certificate verification is disabled for Hub connections");
      const dispatcher = await getDispatcherWithCertBundle(undefined, true);
      this.scopedFetch = getFetchWithDispatcher(dispatcher);
    } else {
      this.scopedFetch = null;
    }

    // Handle authentication
    if (this.config.auth.enabled) {
      try {
        await this.ensureAuthenticated();
        await this.startTokenRefreshTimer();
      } catch (error) {
        if (error instanceof HubConnectionManagerError) {
          this.logger.error("Authentication failed", { error });
          vscode.window.showErrorMessage(`Failed to authenticate with Hub: ${error.message}`);
        } else {
          const classified = classifyNetworkError(error);
          this.logger.error("Authentication failed", {
            category: classified.category,
            summary: classified.summary,
            suggestion: classified.suggestion,
            error,
          });
          vscode.window.showErrorMessage(
            `Failed to authenticate with Hub: ${classified.summary}. ${classified.suggestion}`,
          );
        }

        return; // Can't proceed without auth
      }
    }

    // Verify Hub connectivity and auth before connecting individual features
    try {
      this.logger.info("Verifying Hub connectivity and authentication");
      await this.verifyHubConnectivity();
      this.logger.info("Hub connectivity check passed");
    } catch (error) {
      if (error instanceof HubConnectionManagerError) {
        this.logger.error("Hub connectivity check failed", { error });
        vscode.window.showErrorMessage(`Failed to connect to Hub: ${error.message}`);
      } else {
        const classified = classifyNetworkError(error);
        this.logger.error("Hub connectivity check failed", {
          category: classified.category,
          summary: classified.summary,
          suggestion: classified.suggestion,
          error,
        });
        vscode.window.showErrorMessage(
          `Failed to connect to Hub: ${classified.summary}. ${classified.suggestion}`,
        );
      }

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
          this.scopedFetch ?? undefined,
        );
        await this.solutionServerClient.connect();
        this.logger.info("Successfully connected to Hub solution server");
        vscode.window.showInformationMessage("Successfully connected to Hub solution server");
      } catch (error) {
        this.logger.error("Failed to connect solution server client", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to connect to Hub solution server: ${errorMessage}`);
        this.solutionServerClient = null;
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
          this.scopedFetch ?? undefined,
        );
        await this.profileSyncClient.connect();
        this.logger.info("Successfully connected to Hub profile sync");
        vscode.window.showInformationMessage("Successfully connected to Hub profile sync");

        const llmProxyConfig = this.profileSyncClient.getLLMProxyConfig();
        if (llmProxyConfig) {
          this.logger.info("LLM proxy available", { endpoint: llmProxyConfig.endpoint });
        }

        this.triggerProfileSync();
        this.startProfileSyncTimer();
      } catch (error) {
        this.logger.error("Failed to connect profile sync client", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to connect to Hub profile sync: ${errorMessage}`);
        this.profileSyncClient = null;
      }
    }

    // Notify workflow disposal callback after successful connection
    this.onWorkflowDisposal?.(false);
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

    if (this.solutionServerClient) {
      try {
        await this.solutionServerClient.disconnect();
      } catch (error) {
        this.logger.error("Error disconnecting solution server client", error);
      }
      this.solutionServerClient = null;
    }

    if (this.profileSyncClient) {
      try {
        await this.profileSyncClient.disconnect();
      } catch (error) {
        this.logger.error("Error disconnecting profile sync client", error);
      }
      this.profileSyncClient = null;
    }

    if (!this.isRefreshingTokens) {
      this.clearTokenRefreshTimer();
      this.clearProfileSyncTimer();
      this.bearerToken = null;
      this.refreshToken = null;
      this.tokenExpiresAt = null;
      this.scopedFetch = null;
    }

    this.logger.info("Disconnected from Hub");
  }

  /**
   * Trigger OIDC login manually (e.g., from a command).
   * Uses auth code flow (primary) or device flow (fallback) based on config.
   */
  public async triggerOIDCLogin(): Promise<boolean> {
    const method = this.getAuthMethod();
    if (method === "credentials") {
      this.logger.warn("OIDC login triggered but auth method is credentials");
      return false;
    }

    try {
      await this.ensureOIDCInitialized();

      let tokens: OIDCTokens;

      if (this.oidcAuthCode) {
        // Primary: auth code + PKCE
        tokens = await this.oidcAuthCode.authCodeLogin();
      } else if (this.oidcAuth) {
        // Fallback: device flow
        tokens = await this.oidcAuth.deviceLogin();
      } else {
        return false;
      }

      await this.persistOIDCTokens(tokens);
      this.bearerToken = tokens.accessToken;
      this.tokenExpiresAt = tokens.expiresAt;

      return true;
    } catch (error) {
      this.logger.error("Manual OIDC login failed", { error });
      return false;
    }
  }

  /**
   * Logout from OIDC (clear stored tokens).
   */
  public async oidcLogout(): Promise<void> {
    if (this.oidcAuthCode) {
      this.oidcAuthCode.clearTokens();
    }
    if (this.oidcAuth) {
      this.oidcAuth.clearTokens();
    }
    if (this.oidcTokenStorage) {
      await this.oidcTokenStorage.clear();
    }
    this.bearerToken = null;
    this.tokenExpiresAt = null;
    this.refreshToken = null;
    this.logger.info("OIDC tokens cleared");
  }

  // ─── Private: Authentication ─────────────────────────────────────────────

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
   * Ensure we have a valid authentication token.
   * Dispatches to auth code, device flow, or credentials based on config.
   */
  private async ensureAuthenticated(): Promise<void> {
    const method = this.getAuthMethod();
    if (method === "oidc-auth-code") {
      await this.ensureAuthenticatedAuthCode();
    } else if (method === "oidc") {
      await this.ensureAuthenticatedOIDC();
    } else {
      await this.ensureAuthenticatedCredentials();
    }
  }

  /**
   * Auth Code + PKCE authentication: restore from storage → try refresh → browser flow.
   */
  private async ensureAuthenticatedAuthCode(): Promise<void> {
    await this.ensureOIDCInitialized();

    if (!this.oidcAuthCode || !this.oidcTokenStorage) {
      throw new HubConnectionManagerError(
        "OIDC Auth Code flow not initialized (missing ExtensionContext?)",
      );
    }

    // Step 1: Try to restore tokens from storage
    const storedTokens = await this.oidcTokenStorage.retrieve();
    if (storedTokens) {
      this.oidcAuthCode.setTokens(storedTokens);
      this.logger.info("Restored OIDC tokens from storage");

      // If token is still valid, use it directly
      if (this.oidcAuthCode.isTokenValid()) {
        this.bearerToken = storedTokens.accessToken;
        this.tokenExpiresAt = storedTokens.expiresAt;
        this.logger.info("Stored OIDC token is still valid");
        return;
      }
    }

    // Step 2: Try refresh
    const refreshed = await this.oidcAuthCode.refresh();
    if (refreshed) {
      const tokens = this.oidcAuthCode.getTokens()!;
      await this.persistOIDCTokens(tokens);
      this.bearerToken = tokens.accessToken;
      this.tokenExpiresAt = tokens.expiresAt;
      this.logger.info("OIDC token refreshed successfully");
      return;
    }

    // Step 3: Full auth code + PKCE flow
    this.logger.info("Starting OIDC authorization code + PKCE flow");
    const tokens = await this.oidcAuthCode.login();
    await this.persistOIDCTokens(tokens);
    this.bearerToken = tokens.accessToken;
    this.tokenExpiresAt = tokens.expiresAt;
    this.logger.info("OIDC auth code flow completed");
  }

  /**
   * OIDC Device Flow authentication: restore from storage → try refresh → device flow.
   */
  private async ensureAuthenticatedOIDC(): Promise<void> {
    await this.ensureOIDCInitialized();

    if (!this.oidcAuth || !this.oidcTokenStorage) {
      throw new HubConnectionManagerError(
        "OIDC auth not initialized (missing ExtensionContext?)",
      );
    }

    // Step 1: Try to restore tokens from storage
    const storedTokens = await this.oidcTokenStorage.retrieve();
    if (storedTokens) {
      this.oidcAuth.setTokens(storedTokens);
      this.logger.info("Restored OIDC tokens from storage");

      if (this.oidcAuth.isTokenValid()) {
        this.bearerToken = storedTokens.accessToken;
        this.tokenExpiresAt = storedTokens.expiresAt;
        this.logger.info("Stored OIDC token is still valid");
        return;
      }
    }

    // Step 2: Try refresh
    const refreshed = await this.oidcAuth.refresh();
    if (refreshed) {
      const tokens = this.oidcAuth.getTokens()!;
      await this.persistOIDCTokens(tokens);
      this.bearerToken = tokens.accessToken;
      this.tokenExpiresAt = tokens.expiresAt;
      this.logger.info("OIDC token refreshed successfully");
      return;
    }

    // Step 3: Full device flow login
    this.logger.info("Starting OIDC device flow login");
    const tokens = await this.oidcAuth.login();
    await this.persistOIDCTokens(tokens);
    this.bearerToken = tokens.accessToken;
    this.tokenExpiresAt = tokens.expiresAt;
    this.logger.info("OIDC device flow login completed");
  }

  /**
   * Initialize OIDC auth clients and token storage if not already done.
   */
  private async ensureOIDCInitialized(): Promise<void> {
    if ((this.oidcAuthCode || this.oidcAuth) && this.oidcTokenStorage) {
      return;
    }

    if (!this.extensionContext) {
      throw new HubConnectionManagerError(
        "ExtensionContext required for OIDC auth. Call setExtensionContext() first.",
      );
    }

    const clientId = this.config.auth.oidcClientId ?? DEFAULT_OIDC_CLIENT_ID;
    const issuerUrl = `${this.config.url}/oidc`;

    // Initialize Auth Code flow (primary)
    this.oidcAuthCode = new OIDCAuthCodeFlow(
      issuerUrl,
      clientId,
      undefined, // Use default redirect URI (vscode://konveyor.konveyor-core/auth)
      this.scopedFetch ?? undefined,
    );

    // Register URI handler for catching auth callbacks
    const uriHandlerDisposable = this.oidcAuthCode.registerUriHandler();
    this.extensionContext.subscriptions.push(uriHandlerDisposable);

    // Initialize Device Flow (fallback)
    this.oidcAuth = new OIDCDeviceFlowAuth(
      issuerUrl,
      clientId,
      this.scopedFetch ?? undefined,
    );

    // Initialize token storage
    this.oidcTokenStorage = new OIDCTokenStorage(
      this.extensionContext.secrets,
      this.config.url,
    );

    this.logger.info("OIDC auth initialized", {
      clientId,
      issuerUrl,
      method: this.getAuthMethod(),
    });
  }

  /**
   * Persist OIDC tokens to SecretStorage.
   */
  private async persistOIDCTokens(tokens: OIDCTokens): Promise<void> {
    if (!this.oidcTokenStorage) {
      return;
    }
    try {
      await this.oidcTokenStorage.store(tokens);
      this.logger.info("OIDC tokens persisted to storage");
    } catch (error) {
      this.logger.warn("Failed to persist OIDC tokens", { error });
    }
  }

  /**
   * Legacy credentials authentication via /hub/auth/login.
   */
  private async ensureAuthenticatedCredentials(): Promise<void> {
    if (!this.username || !this.password) {
      throw new HubConnectionManagerError(
        "Authentication is enabled but username/password are not configured",
      );
    }

    this.logger.info("Authenticating with Hub via credentials");

    const fetchFn = this.scopedFetch ?? fetch;

    const response = await fetchFn(`${this.config.url}/hub/auth/login`, {
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

    if (!response.ok) {
      const status = response.status;
      const classified = classifyHttpStatus(status);
      throw new HubConnectionManagerError(
        `Login failed (${status}): ${classified.summary}. ${classified.suggestion}`,
      );
    }

    const data: HubLoginResponse = await response.json();
    this.bearerToken = data.token;
    this.refreshToken = data.refresh ?? null;

    if (data.expiry) {
      this.tokenExpiresAt = Date.now() + data.expiry * 1000;
    }

    this.logger.info("Credentials authentication successful");
  }

  // ─── Private: Token Refresh ──────────────────────────────────────────────

  /**
   * Start a timer to refresh tokens before they expire.
   */
  private async startTokenRefreshTimer(): Promise<void> {
    this.clearTokenRefreshTimer();

    let timeUntilRefresh: number = 0;

    if (this.getAuthMethod() === "oidc-auth-code" && this.oidcAuthCode) {
      timeUntilRefresh = this.oidcAuthCode.getTimeUntilRefresh();
    } else if (this.oidcAuth) {
      timeUntilRefresh = this.oidcAuth.getTimeUntilRefresh();
    } else if (this.tokenExpiresAt) {
      timeUntilRefresh = Math.max(0, this.tokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS - Date.now());
    }

    if (timeUntilRefresh > 0) {
      this.logger.info(`Token refresh scheduled in ${Math.round(timeUntilRefresh / 1000)}s`);
      this.refreshTimer = setTimeout(() => this.refreshTokens(), timeUntilRefresh);
    } else if (this.bearerToken) {
      // Token already needs refresh
      this.logger.info("Token already expired or near expiry, refreshing now");
      await this.refreshTokens();
    }
  }

  /**
   * Refresh tokens using the appropriate flow.
   */
  private async refreshTokens(): Promise<void> {
    this.isRefreshingTokens = true;

    try {
      const method = this.getAuthMethod();
      let refreshed = false;

      if (method === "oidc-auth-code" && this.oidcAuthCode) {
        refreshed = await this.oidcAuthCode.refresh();
        if (refreshed) {
          const tokens = this.oidcAuthCode.getTokens()!;
          await this.persistOIDCTokens(tokens);
          this.bearerToken = tokens.accessToken;
          this.tokenExpiresAt = tokens.expiresAt;
        }
      } else if (method === "oidc" && this.oidcAuth) {
        refreshed = await this.oidcAuth.refresh();
        if (refreshed) {
          const tokens = this.oidcAuth.getTokens()!;
          await this.persistOIDCTokens(tokens);
          this.bearerToken = tokens.accessToken;
          this.tokenExpiresAt = tokens.expiresAt;
        }
      } else if (method === "credentials" && this.refreshToken) {
        refreshed = await this.refreshCredentialsToken();
      }

      if (refreshed) {
        this.logger.info("Token refreshed successfully");
        this.refreshRetryCount = 0;
        await this.startTokenRefreshTimer();

        // Reconnect clients with new token
        await this.connect();
      } else {
        this.logger.warn("Token refresh failed");
        this.handleRefreshFailure();
      }
    } catch (error) {
      this.logger.error("Token refresh error", { error });
      this.handleRefreshFailure();
    } finally {
      this.isRefreshingTokens = false;
    }
  }

  /**
   * Handle refresh failure — prompt for re-login or retry.
   */
  private handleRefreshFailure(): void {
    this.refreshRetryCount++;

    if (this.refreshRetryCount >= 3) {
      // After 3 retries, prompt user to re-authenticate
      const method = this.getAuthMethod();
      if (method === "oidc-auth-code" || method === "oidc") {
        vscode.window
          .showWarningMessage(
            "Hub session expired. Please sign in again.",
            "Sign In",
          )
          .then((action) => {
            if (action === "Sign In") {
              this.triggerOIDCLogin();
            }
          });
      } else {
        vscode.window.showWarningMessage(
          "Hub authentication expired. Please check your credentials.",
        );
      }
    } else {
      // Retry after delay
      this.refreshTimer = setTimeout(
        () => this.refreshTokens(),
        REAUTH_DELAY_MS * this.refreshRetryCount,
      );
    }
  }

  /**
   * Refresh credentials-based token.
   */
  private async refreshCredentialsToken(): Promise<boolean> {
    if (!this.refreshToken) {
      return false;
    }

    const fetchFn = this.scopedFetch ?? fetch;

    try {
      const response = await fetchFn(`${this.config.url}/hub/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ refresh: this.refreshToken }),
      });

      if (!response.ok) {
        return false;
      }

      const data: HubLoginResponse = await response.json();
      this.bearerToken = data.token;
      if (data.refresh) {
        this.refreshToken = data.refresh;
      }
      if (data.expiry) {
        this.tokenExpiresAt = Date.now() + data.expiry * 1000;
      }
      return true;
    } catch {
      return false;
    }
  }

  private clearTokenRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ─── Private: Hub Connectivity Check ─────────────────────────────────────

  /**
   * Verify that we can reach the Hub and auth is working.
   */
  private async verifyHubConnectivity(): Promise<void> {
    const fetchFn = this.scopedFetch ?? fetch;
    const headers: Record<string, string> = { Accept: "application/json" };

    if (this.bearerToken) {
      headers["Authorization"] = `Bearer ${this.bearerToken}`;
    }

    try {
      const response = await fetchFn(`${this.config.url}/hub`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
      });

      if (response.status === 401) {
        throw new HubConnectionManagerError(
          "Authentication required but token was rejected. Try signing in again.",
        );
      }

      if (response.status === 403) {
        throw new HubConnectionManagerError(
          "Access denied. Your account may not have the required permissions.",
        );
      }

      // Accept any 2xx or 3xx as success
      if (response.status >= 400) {
        throw new HubConnectionManagerError(
          `Hub returned unexpected status ${response.status}`,
        );
      }
    } catch (error) {
      if (error instanceof HubConnectionManagerError) {
        throw error;
      }
      throw error;
    }
  }

  // ─── Private: Profile Sync ───────────────────────────────────────────────

  private triggerProfileSync(): void {
    if (this.profileSyncClient?.isConnected) {
      this.profileSyncClient.syncProfiles?.().catch((error: unknown) => {
        this.logger.error("Profile sync failed", { error });
      });
    }
  }

  private startProfileSyncTimer(): void {
    this.clearProfileSyncTimer();
    this.profileSyncTimer = setInterval(
      () => this.triggerProfileSync(),
      PROFILE_SYNC_INTERVAL_MS,
    );
  }

  private clearProfileSyncTimer(): void {
    if (this.profileSyncTimer) {
      clearInterval(this.profileSyncTimer);
      this.profileSyncTimer = null;
    }
  }
}
