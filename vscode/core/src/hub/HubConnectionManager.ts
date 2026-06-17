import { createHash } from "crypto";
import { HubConfig, HubAuthMethod } from "@editor-extensions/shared";
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
import { OIDCAuthCodeFlow, OIDCTokens } from "./OIDCAuthCodeFlow";
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

// Callback type for workflow disposal (called after successful connection)
export type WorkflowDisposalCallback = (tokenRefreshOnly?: boolean) => void;

// Callback type for profile sync (to trigger automatic sync)
export type ProfileSyncCallback = () => Promise<void>;

const TOKEN_EXPIRY_BUFFER_MS = 30000; // 30 second buffer
// Node's setTimeout stores its delay in a 32-bit signed int. A larger delay
// overflows, gets clamped to 1ms, and fires immediately — which for the token
// refresh timer means an unbounded refresh/reconnect loop. Long-lived PATs (see
// PAT_LIFESPAN_HOURS) produce delays far beyond this, so we chunk the wait.
const MAX_TIMER_MS = 2147483647; // 2^31 - 1
const REAUTH_DELAY_MS = 5000; // Delay before re-authentication attempt
const PROFILE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_EXCHANGE_TIMEOUT_MS = 30000; // 30 second timeout for token exchange
const CREDENTIALS_AUTH_MAX_ATTEMPTS = 3;
const CREDENTIALS_AUTH_BASE_DELAY_MS = 2000;
const DEFAULT_OIDC_CLIENT_ID = "kai-ide";
const PAT_LIFESPAN_HOURS = 87600; // ~10 years
const PAT_STORAGE_KEY_PREFIX = "konveyor.hub.pat";

/** Response from POST /auth/tokens (PAT creation). */
interface PATResponse {
  id?: number;
  lifespan?: number;
  expiration?: string;
  token: string;
}

export class HubConnectionManagerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HubConnectionManagerError";
  }
}

/**
 * Manages Hub connection, authentication, and client lifecycle.
 *
 * Supports two authentication methods:
 * - **OIDC Auth Code + PKCE** (default): Uses authorization code flow with PKCE.
 *   Opens browser for auth, catches callback via loopback server.
 * - **Credentials**: Username/password exchanged for a PAT via /hub/auth/tokens (Basic Auth).
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
  private usingPAT: boolean = false;
  private patId: number | null = null;
  private isInteractiveLoginInProgress: boolean = false;
  private authSucceeded: boolean = false;
  private connectionError: string = "";

  // OIDC Auth Code + PKCE state
  private oidcAuthCode: OIDCAuthCodeFlow | null = null;

  // OIDC state
  private oidcIssuerUrl: string | null = null;
  private oidcTokenStorage: OIDCTokenStorage | null = null;
  private extensionContext: vscode.ExtensionContext | null = null;

  // Token refresh retry state
  private isRefreshingTokens: boolean = false;
  private refreshRetryCount: number = 0;

  // Profile sync state
  private profileSyncTimer: NodeJS.Timeout | null = null;

  // Connection-scoped fetch for insecure Hub connections
  private scopedFetch: typeof fetch | null = null;

  // Mutex: coalesce concurrent connect() calls into a single in-flight operation
  private connectPromise: Promise<void> | null = null;

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
   * Defaults to "oidc" (authorization code + PKCE flow).
   */
  public getAuthMethod(): HubAuthMethod {
    return this.config.auth.method ?? "oidc";
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
   * Get the OIDC username (or basic auth username) for display
   */
  public getOidcUsername(): string {
    // Only expose username when authentication has actually succeeded
    return this.authSucceeded ? this.username : "";
  }

  /**
   * Get the token expiry timestamp (epoch ms) or null if not available
   */
  public getTokenExpiry(): number | null {
    // PATs are long-lived; hide misleading expiry from the UI
    if (this.usingPAT) {
      return null;
    }
    return this.authSucceeded ? this.tokenExpiresAt : null;
  }

  /**
   * Get the last connection error message, or empty string if none
   */
  public getConnectionError(): string {
    return this.connectionError;
  }

  /**
   * Check if authentication is valid
   */
  public hasValidAuth(): boolean {
    if (!this.config.auth.enabled) {
      return true;
    }

    // OIDC: check via the auth client
    if (this.getAuthMethod() === "oidc" && this.oidcAuthCode) {
      return this.oidcAuthCode.isTokenValid();
    }

    // Credentials or PAT: check bearer token directly.
    // PATs may not have an expiry (long-lived), so having a token is sufficient.
    if (!this.bearerToken) {
      return false;
    }
    if (this.tokenExpiresAt) {
      return this.tokenExpiresAt > Date.now();
    }
    // No expiry set (e.g. long-lived PAT) — token presence means valid
    return true;
  }

  /**
   * Connect to Hub (idempotent)
   *
   * Always disconnects first, then connects enabled features with current config/token.
   * Safe to call anytime - handles initial connection, reconnection, and config changes.
   */
  public async connect(): Promise<void> {
    if (this.connectPromise) {
      this.logger.info("connect() already in progress, coalescing");
      return this.connectPromise;
    }
    this.connectPromise = this._connect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async _connect(): Promise<void> {
    this.connectionError = "";

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
      const dispatcher = await getDispatcherWithCertBundle(
        undefined,
        true,
        false,
        this.logger,
        this.config.url,
      );
      this.scopedFetch = getFetchWithDispatcher(dispatcher);
    } else {
      this.scopedFetch = null;
    }

    // Handle authentication
    if (this.config.auth.enabled) {
      try {
        const method = this.getAuthMethod();
        if (method === "credentials") {
          await this.connectWithCredentials();
        } else {
          await this.connectWithOIDC();
        }
      } catch (error) {
        if (error instanceof HubConnectionManagerError) {
          this.logger.error("Authentication failed", { error });
          // Don't surface "please sign in" as an error for OIDC — the status
          // card's Sign In button and guidance text already handle that state.
          if (this.getAuthMethod() === "credentials") {
            this.connectionError = error.message;
          }
        } else {
          const classified = classifyNetworkError(error);
          this.logger.error("Authentication failed", {
            category: classified.category,
            summary: classified.summary,
            suggestion: classified.suggestion,
            error,
          });
          this.connectionError = `${classified.summary}. ${classified.suggestion}`;
        }

        return; // Can't proceed without auth
      }
    }

    // Verify Hub connectivity and auth before connecting individual features
    try {
      this.logger.info("Verifying Hub connectivity and authentication");
      await this.verifyHubConnectivity();
      this.logger.info("Hub connectivity check passed");
      this.authSucceeded = true;

      // Fetch human-readable username from userinfo endpoint (non-blocking).
      // The JWT only contains `sub` (a UUID); preferred_username lives on /oidc/userinfo.
      // Only relevant for OIDC — credentials auth already knows the username from config.
      if (this.config.auth.enabled && this.bearerToken && this.getAuthMethod() === "oidc") {
        this.fetchUsernameFromUserinfo().catch((err) => {
          this.logger.debug("Userinfo fetch failed, keeping JWT-extracted username", { err });
        });
      }
    } catch (error) {
      // If stored PAT was rejected, clear it and fall back to OIDC re-auth
      if (
        this.usingPAT &&
        error instanceof HubConnectionManagerError &&
        error.message.includes("rejected")
      ) {
        this.logger.warn("Stored PAT rejected, clearing and requiring re-authentication");
        await this.clearPAT();
        this.bearerToken = null;
        this.usingPAT = false;
        vscode.window
          .showWarningMessage("Hub API key expired. Please sign in again.", "Sign In")
          .then((action) => {
            if (action === "Sign In") {
              executeExtensionCommand("hubOidcLogin");
            }
          });
        return;
      }
      if (error instanceof HubConnectionManagerError) {
        this.logger.error("Hub connectivity check failed", { error });
        this.connectionError = error.message;
      } else {
        const classified = classifyNetworkError(error);
        this.logger.error("Hub connectivity check failed", {
          category: classified.category,
          summary: classified.summary,
          suggestion: classified.suggestion,
          error,
        });
        this.connectionError = `${classified.summary}. ${classified.suggestion}`;
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
        await this.profileSyncClient.connect({ skipConnectivityCheck: true });
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
   * Reconnect solution server and profile sync clients with the current bearer token,
   * without re-authenticating. Used by token refresh to avoid double-minting tokens.
   */
  private async reconnectClients(): Promise<void> {
    // Connect Solution Server
    if (this.config.features.solutionServer.enabled) {
      try {
        this.logger.info("Reconnecting solution server client", { hubUrl: this.config.url });
        this.solutionServerClient = new SolutionServerClient(
          this.config.url,
          this.bearerToken,
          this.logger,
          this.scopedFetch ?? undefined,
        );
        await this.solutionServerClient.connect();
        this.logger.info("Successfully reconnected to Hub solution server");
      } catch (error) {
        this.logger.error("Failed to reconnect solution server client", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to connect to Hub solution server: ${errorMessage}`);
        this.solutionServerClient = null;
      }
    }

    // Connect Profile Sync
    if (this.config.features.profileSync.enabled) {
      try {
        this.logger.info("Reconnecting profile sync client");
        this.profileSyncClient = new ProfileSyncClient(
          this.config.url,
          this.bearerToken,
          this.logger,
          this.scopedFetch ?? undefined,
        );
        await this.profileSyncClient.connect({ skipConnectivityCheck: true });
        this.logger.info("Successfully reconnected to Hub profile sync");

        const llmProxyConfig = this.profileSyncClient.getLLMProxyConfig();
        if (llmProxyConfig) {
          this.logger.info("LLM proxy available", { endpoint: llmProxyConfig.endpoint });
        }

        this.triggerProfileSync();
        this.startProfileSyncTimer();
      } catch (error) {
        this.logger.error("Failed to reconnect profile sync client", error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to connect to Hub profile sync: ${errorMessage}`);
        this.profileSyncClient = null;
      }
    }
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
      this.authSucceeded = false;
    }

    this.logger.info("Disconnected from Hub");
  }

  /**
   * Trigger OIDC login manually (e.g., from a command).
   */
  public async triggerOIDCLogin(): Promise<boolean> {
    const method = this.getAuthMethod();
    if (method === "credentials") {
      this.logger.warn("OIDC login triggered but auth method is credentials");
      return false;
    }

    try {
      this.isInteractiveLoginInProgress = true;

      // Ensure scopedFetch is available (disconnect clears it, but OIDC flows need it for insecure certs)
      if (this.config.auth.insecure && !this.scopedFetch) {
        const dispatcher = await getDispatcherWithCertBundle(undefined, true);
        this.scopedFetch = getFetchWithDispatcher(dispatcher);
      }

      await this.ensureOIDCInitialized();

      if (!this.oidcAuthCode) {
        return false;
      }

      const tokens = await this.oidcAuthCode.authCodeLogin();

      await this.persistOIDCTokens(tokens);
      this.bearerToken = tokens.accessToken;
      this.tokenExpiresAt = tokens.expiresAt;

      // Resolve human-readable username while OIDC token is still active
      await this.fetchUsernameFromUserinfo();
      // Exchange for long-lived PAT before reconnecting
      await this.exchangeForPAT();

      // After successful interactive login, reconnect to Hub
      await this.connect();

      return true;
    } catch (error) {
      const errorDetails =
        error instanceof Error
          ? { message: error.message, name: error.name, stack: error.stack }
          : { raw: String(error) };
      this.logger.error("Manual OIDC login failed", { error: errorDetails });
      return false;
    } finally {
      this.isInteractiveLoginInProgress = false;
    }
  }

  /**
   * Logout from OIDC (clear stored tokens).
   */
  public async oidcLogout(): Promise<void> {
    // Server-side cleanup before clearing local state
    try {
      if (!this.oidcAuthCode && this.getAuthMethod() === "oidc") {
        await this.ensureOIDCInitialized();
      }
      if (this.oidcAuthCode && this.oidcTokenStorage && !this.oidcAuthCode.getTokens()) {
        const storedTokens = await this.oidcTokenStorage.retrieve();
        if (storedTokens) {
          this.oidcAuthCode.setTokens(storedTokens);
        }
      }
      if (this.oidcAuthCode) {
        await this.oidcAuthCode.endSession();
      }
    } catch (error) {
      this.logger.warn("Failed to end OIDC session on server", { error });
    }
    await this.revokePAT();

    // Disconnect all active clients
    await this.disconnect();

    // Clear local state
    if (this.oidcAuthCode) {
      this.oidcAuthCode.clearTokens();
    }
    if (this.oidcTokenStorage) {
      await this.oidcTokenStorage.clear();
    }
    this.bearerToken = null;
    this.tokenExpiresAt = null;
    this.refreshToken = null;
    this.usingPAT = false;
    this.authSucceeded = false;
    await this.clearPAT();
    this.patId = null;
    this.clearTokenRefreshTimer();
    this.logger.info("OIDC tokens and PAT cleared, disconnected from Hub");
  }

  // ─── Private: Authentication ─────────────────────────────────────────────

  /**
   * Handle the credentials authentication path during connect().
   * Performs login via username/password and starts the token refresh timer.
   */
  private async connectWithCredentials(): Promise<void> {
    await this.ensureAuthenticatedCredentials();
    await this.startTokenRefreshTimer();
  }

  /**
   * Handle the OIDC authentication path during connect().
   * Attempts to restore a stored PAT first; if unavailable, performs the
   * OIDC auth code flow and exchanges the token for a long-lived PAT.
   * Only starts the token refresh timer when not using a PAT.
   */
  private async connectWithOIDC(): Promise<void> {
    const storedPAT = await this.retrievePAT();
    if (storedPAT) {
      this.bearerToken = storedPAT;
      this.usingPAT = true;
      // Try to extract username from token; keep config username as fallback
      const extracted = this.extractUsernameFromToken(storedPAT);
      if (extracted) {
        this.username = extracted;
      }
      // PATs are long-lived; null signals "no expiration" to the webview
      this.tokenExpiresAt = null;
      this.logger.info("Using stored PAT for authentication");
    } else {
      this.usingPAT = false;
      await this.ensureAuthenticated(false);
      // Resolve username from userinfo while we still have the OIDC access token
      // (the PAT may not work against the OIDC userinfo endpoint)
      await this.fetchUsernameFromUserinfo();
      await this.exchangeForPAT();
    }
    if (!this.usingPAT) {
      await this.startTokenRefreshTimer();
    }
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
   * Ensure we have a valid authentication token.
   * Dispatches to auth code + PKCE or credentials based on config.
   */
  private async ensureAuthenticated(interactive: boolean = false): Promise<void> {
    if (this.getAuthMethod() === "oidc") {
      await this.ensureAuthenticatedAuthCode(interactive);
    } else {
      await this.ensureAuthenticatedCredentials();
    }
  }

  /**
   * Auth Code + PKCE authentication: restore from storage → try refresh → browser flow.
   * @param interactive - If true, allows opening browser for login. If false (startup),
   *   will throw if no valid/refreshable tokens exist rather than opening the browser.
   */
  private async ensureAuthenticatedAuthCode(interactive: boolean = false): Promise<void> {
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

      // Hydrate display username from stored access token
      const extracted = this.extractUsernameFromToken(storedTokens.accessToken);
      if (extracted) {
        this.username = extracted;
      }

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

    // Step 3: If non-interactive (startup), don't open browser — throw to signal auth needed
    if (!interactive) {
      this.logger.info("No valid tokens and non-interactive mode — sign-in required");
      throw new HubConnectionManagerError(
        "Authentication required. Please sign in to connect to Hub.",
      );
    }

    // Step 4: Full auth code + PKCE flow (interactive only)
    this.logger.info("Starting OIDC authorization code + PKCE flow");
    const tokens = await this.oidcAuthCode.login();
    await this.persistOIDCTokens(tokens);
    this.bearerToken = tokens.accessToken;
    this.tokenExpiresAt = tokens.expiresAt;
    this.logger.info("OIDC auth code flow completed");
  }

  /**
   * Initialize OIDC auth clients and token storage if not already done.
   */
  private async ensureOIDCInitialized(): Promise<void> {
    const expectedIssuerUrl = `${this.config.url}/oidc`;
    if (this.oidcAuthCode && this.oidcTokenStorage && this.oidcIssuerUrl === expectedIssuerUrl) {
      return;
    }

    if (!this.extensionContext) {
      throw new HubConnectionManagerError(
        "ExtensionContext required for OIDC auth. Call setExtensionContext() first.",
      );
    }

    const clientId = this.config.auth.oidcClientId ?? DEFAULT_OIDC_CLIENT_ID;
    const issuerUrl = `${this.config.url}/oidc`;

    this.oidcAuthCode = new OIDCAuthCodeFlow(issuerUrl, clientId, this.scopedFetch ?? undefined);
    this.oidcTokenStorage = new OIDCTokenStorage(this.extensionContext.secrets, this.config.url);

    this.logger.info("OIDC auth initialized", {
      clientId,
      issuerUrl,
      method: this.getAuthMethod(),
    });

    this.oidcIssuerUrl = issuerUrl;
  }

  // ─── Private: PAT Exchange ─────────────────────────────────────────────────

  /**
   * Exchange the current short-lived OIDC access token for a long-lived
   * Personal Access Token (PAT) via POST /auth/tokens.
   *
   * On success, replaces bearerToken with the PAT and persists it.
   * On failure, logs a warning and continues with the short-lived token.
   */
  private async exchangeForPAT(): Promise<void> {
    if (!this.bearerToken) {
      return;
    }

    const fetchFn = this.scopedFetch ?? fetch;
    const url = `${this.config.url}/hub/auth/tokens`;

    try {
      this.logger.info("Exchanging OIDC token for long-lived PAT", {
        lifespan: PAT_LIFESPAN_HOURS,
      });

      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${this.bearerToken}`,
        },
        body: JSON.stringify({ lifespan: PAT_LIFESPAN_HOURS }),
        signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        this.logger.warn("PAT exchange failed", {
          status: response.status,
          body: body.substring(0, 200),
        });
        return;
      }

      const data = (await response.json()) as PATResponse;
      if (!data.token) {
        this.logger.warn("PAT exchange returned no token");
        return;
      }

      // Success — switch to PAT
      this.bearerToken = data.token;
      this.usingPAT = true;
      this.patId = data.id ?? null;
      // PATs are long-lived; use null to signal "no expiration" to the UI
      this.tokenExpiresAt = data.expiration ? new Date(data.expiration).getTime() : null;

      // Persist PAT
      await this.storePAT(data.token, this.patId);

      this.logger.info("Successfully exchanged OIDC token for PAT", {
        patId: data.id,
        expiresAt: this.tokenExpiresAt ? new Date(this.tokenExpiresAt).toISOString() : "unknown",
      });
    } catch (error) {
      this.logger.warn("PAT exchange request failed, continuing with OIDC token", { error });
    }
  }

  /**
   * Build a deterministic storage key for PAT based on hub URL.
   */
  private getPATStorageKey(): string {
    const url = new URL(this.config.url.replace(/\/$/, ""));
    url.hostname = url.hostname.toLowerCase();
    const hash = createHash("sha256").update(url.toString()).digest("hex").substring(0, 16);
    return `${PAT_STORAGE_KEY_PREFIX}.${hash}`;
  }

  /**
   * Store PAT in VS Code SecretStorage.
   */
  private async storePAT(token: string, id: number | null): Promise<void> {
    if (!this.extensionContext) {
      return;
    }
    try {
      const key = this.getPATStorageKey();
      await this.extensionContext.secrets.store(
        key,
        JSON.stringify({ token, username: this.username, id }),
      );
      this.logger.info("PAT stored in SecretStorage");
    } catch (error) {
      this.logger.warn("Failed to store PAT", { error });
    }
  }

  /**
   * Retrieve stored PAT from VS Code SecretStorage.
   * Returns the token string or null if not stored.
   */
  private async retrievePAT(): Promise<string | null> {
    if (!this.extensionContext) {
      return null;
    }
    try {
      const key = this.getPATStorageKey();
      const raw = await this.extensionContext.secrets.get(key);
      if (!raw) {
        return null;
      }
      // Support both legacy (plain token) and new (JSON with username) formats
      try {
        const parsed = JSON.parse(raw) as { token: string; username?: string; id?: number };
        if (parsed.username) {
          this.username = parsed.username;
        }
        if (parsed.id) {
          this.patId = parsed.id;
        }
        return parsed.token;
      } catch {
        // Legacy plain-text token
        return raw;
      }
    } catch {
      return null;
    }
  }

  /**
   * Revoke PAT on the Hub server via DELETE /auth/tokens/:id.
   */
  private async revokePAT(): Promise<void> {
    if (!this.patId || !this.bearerToken) {
      return;
    }
    const fetchFn = this.scopedFetch ?? fetch;
    const url = `${this.config.url}/hub/auth/tokens/${this.patId}`;
    try {
      const response = await fetchFn(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${this.bearerToken}` },
        signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn("PAT revocation returned non-OK status", {
          patId: this.patId,
          status: response.status,
        });
      } else {
        this.logger.info("PAT revoked on Hub", { patId: this.patId });
      }
    } catch (error) {
      this.logger.warn("Failed to revoke PAT on Hub", { patId: this.patId, error });
    }
  }

  /**
   * Clear stored PAT (used on logout).
   */
  private async clearPAT(): Promise<void> {
    if (!this.extensionContext) {
      return;
    }
    try {
      const key = this.getPATStorageKey();
      await this.extensionContext.secrets.delete(key);
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Persist OIDC tokens to SecretStorage.
   */
  private async persistOIDCTokens(tokens: OIDCTokens): Promise<void> {
    // Extract display username from the access token
    const extracted = this.extractUsernameFromToken(tokens.accessToken);
    if (extracted) {
      this.username = extracted;
    }

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
   * Extract display username from a JWT access token's claims.
   * Tries preferred_username, name, email, then sub.
   */
  private extractUsernameFromToken(token: string): string {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return "";
      }
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      const username =
        payload.preferred_username || payload.name || payload.email || payload.sub || "";
      return typeof username === "string" ? username.trim() : "";
    } catch {
      return "";
    }
  }

  /**
   * Fetch the human-readable username from the OIDC userinfo endpoint.
   *
   * Hub's JWT only contains `sub` (a UUID). The friendly `preferred_username`
   * is available via GET {hubUrl}/oidc/userinfo with the bearer token.
   * Falls back to extractUsernameFromToken if userinfo fails.
   */
  private async fetchUsernameFromUserinfo(): Promise<void> {
    if (!this.bearerToken) {
      return;
    }

    const fetchFn = this.scopedFetch ?? fetch;
    const userinfoUrl = `${this.config.url}/oidc/userinfo`;

    try {
      const response = await fetchFn(userinfoUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        this.logger.debug("Userinfo endpoint returned non-OK status", {
          status: response.status,
        });
        return;
      }

      const data = (await response.json()) as Record<string, unknown>;
      const resolved =
        (typeof data.preferred_username === "string" && data.preferred_username.trim()) ||
        (typeof data.email === "string" && data.email.trim()) ||
        (typeof data.sub === "string" && data.sub.trim()) ||
        "";

      if (resolved) {
        this.username = resolved;
        this.logger.info("Username resolved from userinfo endpoint", {
          username: resolved,
        });
      }
    } catch (error) {
      this.logger.debug("Failed to fetch userinfo", { error });
      // Non-fatal: we keep whatever extractUsernameFromToken found
    }
  }

  /**
   * Credentials authentication via /hub/auth/tokens (Basic Auth → PAT).
   * Retries on transient failures (timeouts, network errors) with exponential backoff.
   */
  private async ensureAuthenticatedCredentials(): Promise<void> {
    if (!this.username || !this.password) {
      throw new HubConnectionManagerError(
        "Authentication is enabled but username/password are not configured",
      );
    }

    this.logger.info("Authenticating with Hub via credentials (token endpoint)");

    const fetchFn = this.scopedFetch ?? fetch;
    const basicAuth = Buffer.from(`${this.username}:${this.password}`).toString("base64");
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= CREDENTIALS_AUTH_MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetchFn(`${this.config.url}/hub/auth/tokens`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Basic ${basicAuth}`,
          },
          body: "{}",
          signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
        });

        if (!response.ok) {
          const status = response.status;
          const classified = classifyHttpStatus(status, response.statusText);
          throw new HubConnectionManagerError(
            `Login failed (${status}): ${classified.summary}. ${classified.suggestion}`,
          );
        }

        const data = (await response.json()) as {
          token: string;
          expiration?: string;
          lifespan?: number;
        };
        this.bearerToken = data.token;
        this.refreshToken = null;

        if (data.expiration) {
          const expiresAt = Date.parse(data.expiration);
          if (Number.isFinite(expiresAt)) {
            this.tokenExpiresAt = expiresAt;
          }
        } else if (typeof data.lifespan === "number" && Number.isFinite(data.lifespan)) {
          this.tokenExpiresAt = Date.now() + data.lifespan * 60 * 60 * 1000;
        } else {
          this.tokenExpiresAt = null;
        }

        this.logger.info("Credentials authentication successful (PAT minted)");
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof HubConnectionManagerError && /40[13]/.test(error.message)) {
          throw error;
        }

        if (attempt < CREDENTIALS_AUTH_MAX_ATTEMPTS) {
          const delay = CREDENTIALS_AUTH_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          this.logger.warn(
            `Credentials auth attempt ${attempt}/${CREDENTIALS_AUTH_MAX_ATTEMPTS} failed: ${lastError.message}. Retrying in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  // ─── Private: Token Refresh ──────────────────────────────────────────────

  /**
   * Start a timer to refresh tokens before they expire.
   */
  private async startTokenRefreshTimer(): Promise<void> {
    this.clearTokenRefreshTimer();

    let timeUntilRefresh: number = 0;

    if (this.getAuthMethod() === "oidc" && this.oidcAuthCode) {
      timeUntilRefresh = this.oidcAuthCode.getTimeUntilRefresh();
    } else if (this.tokenExpiresAt) {
      timeUntilRefresh = Math.max(0, this.tokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS - Date.now());
    }

    if (timeUntilRefresh > MAX_TIMER_MS) {
      // Delay exceeds Node's max timer. Wait the max, then re-evaluate rather
      // than refresh — a single setTimeout this large would overflow to 1ms and
      // spin the refresh/reconnect loop continuously.
      this.logger.info(
        `Token refresh is ${Math.round(timeUntilRefresh / 1000)}s out; ` +
          `re-evaluating in ${Math.round(MAX_TIMER_MS / 1000)}s`,
      );
      this.refreshTimer = setTimeout(() => {
        void this.startTokenRefreshTimer();
      }, MAX_TIMER_MS);
    } else if (timeUntilRefresh > 0) {
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

      if (method === "oidc" && this.oidcAuthCode) {
        refreshed = await this.oidcAuthCode.refresh();
        if (refreshed) {
          const tokens = this.oidcAuthCode.getTokens()!;
          await this.persistOIDCTokens(tokens);
          this.bearerToken = tokens.accessToken;
          this.tokenExpiresAt = tokens.expiresAt;
        }
      } else if (method === "credentials") {
        refreshed = await this.refreshCredentialsToken();
      }

      if (refreshed) {
        this.logger.info("Token refreshed successfully");
        this.refreshRetryCount = 0;
        await this.startTokenRefreshTimer();

        // Reconnect clients with new token (without re-authenticating)
        await this.reconnectClients();
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
      if (method === "oidc") {
        vscode.window
          .showWarningMessage("Hub session expired. Please sign in again.", "Sign In")
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
    // Hub PATs from /hub/auth/tokens don't support refresh — mint a new one.
    if (!this.username || !this.password) {
      return false;
    }

    try {
      await this.ensureAuthenticatedCredentials();
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

    // Use /hub/applications as the connectivity check (matches main branch behavior).
    // 404 is acceptable (no applications exist), but auth failures are not.
    const checkUrl = `${this.config.url}/hub/applications`;

    try {
      const response = await fetchFn(checkUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
      });

      // 404 is acceptable (no applications exist yet)
      if (response.status === 404) {
        return;
      }

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
        throw new HubConnectionManagerError(`Hub returned unexpected status ${response.status}`);
      }
    } catch (error) {
      if (error instanceof HubConnectionManagerError) {
        throw error;
      }
      this.logger.error("Hub connectivity check failed", {
        error,
        checkUrl: sanitizeUrl(checkUrl),
      });
      throw error;
    }
  }

  // ─── Private: Profile Sync ───────────────────────────────────────────────

  private triggerProfileSync(): void {
    if (!this.profileSyncClient?.isConnected) {
      this.logger.debug("Profile sync client not connected, skipping sync");
      return;
    }

    // Delegate to the syncHubProfiles command which has workspace/repo context
    executeExtensionCommand("syncHubProfiles", true).then(
      () => {},
      (error: unknown) => {
        this.logger.error("Profile sync failed", { error });
      },
    );
  }

  private startProfileSyncTimer(): void {
    this.clearProfileSyncTimer();
    this.profileSyncTimer = setInterval(() => this.triggerProfileSync(), PROFILE_SYNC_INTERVAL_MS);
  }

  private clearProfileSyncTimer(): void {
    if (this.profileSyncTimer) {
      clearInterval(this.profileSyncTimer);
      this.profileSyncTimer = null;
    }
  }
}
