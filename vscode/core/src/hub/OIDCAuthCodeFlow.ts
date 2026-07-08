/**
 * OIDC Authorization Code + PKCE Flow for Konveyor Hub.
 *
 * Uses oauth4webapi for spec-compliant OIDC discovery, token exchange,
 * refresh, and end-session. The loopback callback server (OIDCLoopbackServer)
 * is still ours — oauth4webapi handles the protocol, not the transport.
 *
 * @module OIDCAuthCodeFlow
 */
import * as vscode from "vscode";
import * as oauth from "oauth4webapi";
import { OIDCLoopbackServer } from "./OIDCLoopbackServer";

// ─── Shared OIDC Types ─────────────────────────────────────────────────────

/** Persisted token set. */
export interface OIDCTokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresAt: number | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const OIDC_SCOPES = "openid profile email offline_access";
const TOKEN_EXPIRY_BUFFER_MS = 30_000; // 30s before actual expiry

/** Timeout for waiting for the auth callback (5 minutes). */
const AUTH_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Errors ──────────────────────────────────────────────────────────────────

export class OIDCAuthCodeError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "OIDCAuthCodeError";
  }
}

export class OIDCAuthCodeCancelledError extends OIDCAuthCodeError {
  constructor() {
    super("Authorization code flow was cancelled", "cancelled");
    this.name = "OIDCAuthCodeCancelledError";
  }
}

export class OIDCAuthCodeTimeoutError extends OIDCAuthCodeError {
  constructor() {
    super("Authorization timed out. Please try signing in again.", "timeout");
    this.name = "OIDCAuthCodeTimeoutError";
  }
}

export class OIDCAuthCodeStateError extends OIDCAuthCodeError {
  constructor() {
    super("State parameter mismatch — possible CSRF attack. Please try again.", "state_mismatch");
    this.name = "OIDCAuthCodeStateError";
  }
}

// ─── Main Class ──────────────────────────────────────────────────────────────

export class OIDCAuthCodeFlow {
  private readonly issuerUrl: string;
  private readonly clientId: string;
  private readonly client: oauth.Client;
  private readonly fetchOptions: { [oauth.customFetch]: typeof fetch } | undefined;

  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private idToken: string | null = null;
  private expiresAt: number | null = null;
  private loginInProgress: boolean = false;
  private authServer: oauth.AuthorizationServer | null = null;

  constructor(issuerUrl: string, clientId: string, customFetch?: typeof fetch) {
    this.issuerUrl = issuerUrl.replace(/\/$/, "");
    this.clientId = clientId;
    this.client = { client_id: clientId };
    if (customFetch) {
      this.fetchOptions = { [oauth.customFetch]: customFetch };
    }
  }

  // ─── Token State ───────────────────────────────────────────────────────────

  public setTokens(tokens: OIDCTokens): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.idToken = tokens.idToken;
    this.expiresAt = tokens.expiresAt;
  }

  public getTokens(): OIDCTokens | null {
    if (!this.accessToken) {
      return null;
    }
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      idToken: this.idToken,
      expiresAt: this.expiresAt,
    };
  }

  public getHeader(): string | null {
    if (!this.accessToken) {
      return null;
    }
    return `Bearer ${this.accessToken}`;
  }

  public hasToken(): boolean {
    return !!this.accessToken;
  }

  public isTokenValid(): boolean {
    if (!this.accessToken) {
      return false;
    }
    if (!this.expiresAt) {
      return true;
    }
    return Date.now() < this.expiresAt - TOKEN_EXPIRY_BUFFER_MS;
  }

  /**
   * Milliseconds until the token should be refreshed, 0 if it is already due,
   * or null if the token has no known expiry (isTokenValid() treats such
   * tokens as valid indefinitely, so there is nothing to refresh).
   */
  public getTimeUntilRefresh(): number | null {
    if (!this.expiresAt) {
      return null;
    }
    const remaining = this.expiresAt - TOKEN_EXPIRY_BUFFER_MS - Date.now();
    return Math.max(0, remaining);
  }

  public clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.idToken = null;
    this.expiresAt = null;
  }

  public async endSession(): Promise<void> {
    const as = await this.discover();
    if (!as.end_session_endpoint) {
      return;
    }

    const params = new URLSearchParams({ client_id: this.clientId });
    if (this.idToken) {
      params.set("id_token_hint", this.idToken);
    }

    const url = `${as.end_session_endpoint}?${params.toString()}`;
    const fetchFn = this.fetchOptions?.[oauth.customFetch] ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetchFn(url, { signal: controller.signal });
      if (!response.ok) {
        throw new OIDCAuthCodeError(
          `OIDC end-session returned status ${response.status}`,
          "end_session_failed",
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Authentication Flows ──────────────────────────────────────────────────

  public async login(cancellationToken?: vscode.CancellationToken): Promise<OIDCTokens> {
    if (this.refreshToken) {
      const refreshed = await this.refresh();
      if (refreshed) {
        return this.getTokens()!;
      }
    }

    return this.authCodeLogin(cancellationToken);
  }

  public async refresh(): Promise<boolean> {
    if (!this.refreshToken) {
      return false;
    }

    try {
      const as = await this.discover();
      const response = await oauth.refreshTokenGrantRequest(
        as,
        this.client,
        oauth.None(),
        this.refreshToken,
        this.requestOptions,
      );

      const result = await oauth.processRefreshTokenResponse(as, this.client, response);

      this.updateTokensFromResponse(result);
      return true;
    } catch (err) {
      if (
        err instanceof oauth.ResponseBodyError ||
        err instanceof oauth.WWWAuthenticateChallengeError
      ) {
        this.refreshToken = null;
      }
      return false;
    }
  }

  public async authCodeLogin(cancellationToken?: vscode.CancellationToken): Promise<OIDCTokens> {
    if (this.loginInProgress) {
      throw new OIDCAuthCodeError(
        "A sign-in is already in progress. Please wait for it to complete.",
        "login_already_in_progress",
      );
    }
    this.loginInProgress = true;

    const server = new OIDCLoopbackServer();
    let timeoutHandle: NodeJS.Timeout | undefined;
    let cancellationDisposable: vscode.Disposable | undefined;

    try {
      const as = await this.discover();

      await server.start();
      const redirectUri = server.getRedirectUri();

      const codeVerifier = oauth.generateRandomCodeVerifier();
      const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
      const state = oauth.generateRandomState();

      server.setExpectedState(state);

      if (!as.authorization_endpoint) {
        throw new OIDCAuthCodeError(
          "Authorization endpoint not found in discovery",
          "discovery_failed",
        );
      }

      const authUrl = new URL(as.authorization_endpoint);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", this.clientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("scope", OIDC_SCOPES);
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("state", state);

      timeoutHandle = setTimeout(() => {
        server.abort(new OIDCAuthCodeTimeoutError());
      }, AUTH_CALLBACK_TIMEOUT_MS);

      if (cancellationToken) {
        cancellationDisposable = cancellationToken.onCancellationRequested(() => {
          server.abort(new OIDCAuthCodeCancelledError());
        });
      }

      const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));
      if (!opened) {
        throw new OIDCAuthCodeError(
          "Failed to open browser for authentication. Please try again.",
          "browser_open_failed",
        );
      }

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Waiting for sign-in to complete in browser...",
          cancellable: true,
        },
        (_progress, token) => {
          token.onCancellationRequested(() => {
            server.abort(new OIDCAuthCodeCancelledError());
          });
          return server
            .waitForCallback()
            .then(() => {})
            .catch(() => {});
        },
      );

      const result = await server.waitForCallback();

      const validatedParams = oauth.validateAuthResponse(as, this.client, result.url, state);

      const response = await oauth.authorizationCodeGrantRequest(
        as,
        this.client,
        oauth.None(),
        validatedParams,
        redirectUri,
        codeVerifier,
        this.requestOptions,
      );

      const tokenResult = await oauth.processAuthorizationCodeResponse(as, this.client, response, {
        expectedNonce: oauth.expectNoNonce,
      });

      this.updateTokensFromResponse(tokenResult);

      vscode.window.showInformationMessage("Successfully signed in to Konveyor Hub");

      return this.getTokens()!;
    } finally {
      this.loginInProgress = false;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      cancellationDisposable?.dispose();
      await server.stop().catch(() => {});
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private get isLoopback(): boolean {
    try {
      const { hostname } = new URL(this.issuerUrl);
      return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    } catch {
      return false;
    }
  }

  private get requestOptions() {
    return {
      ...(this.isLoopback && { [oauth.allowInsecureRequests]: true }),
      ...this.fetchOptions,
    };
  }

  private async discover(): Promise<oauth.AuthorizationServer> {
    if (this.authServer) {
      return this.authServer;
    }

    const issuer = new URL(this.issuerUrl);
    const response = await oauth.discoveryRequest(issuer, {
      algorithm: "oidc",
      ...this.requestOptions,
    });

    this.authServer = await oauth.processDiscoveryResponse(issuer, response);
    return this.authServer;
  }

  private updateTokensFromResponse(result: oauth.TokenEndpointResponse): void {
    this.accessToken = result.access_token;

    if (result.refresh_token) {
      this.refreshToken = result.refresh_token;
    }

    if (result.id_token) {
      this.idToken = result.id_token;
    }

    if (result.expires_in) {
      this.expiresAt = Date.now() + result.expires_in * 1000;
    } else {
      this.expiresAt = this.extractExpiryFromJWT(result.access_token);
    }
  }

  private extractExpiryFromJWT(token: string): number | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return null;
      }
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      if (typeof payload.exp === "number") {
        return payload.exp * 1000;
      }
    } catch {
      // Not a valid JWT
    }
    return null;
  }

  public dispose(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.idToken = null;
    this.expiresAt = null;
  }
}
