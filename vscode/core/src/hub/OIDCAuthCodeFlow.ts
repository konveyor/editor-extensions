/**
 * OIDC Authorization Code + PKCE Flow for Konveyor Hub.
 *
 * Implements OAuth 2.0 Authorization Code Grant with PKCE (RFC 7636)
 * against the hub's builtin OIDC provider (PR #1042).
 *
 * Flow:
 *   1. Generate PKCE code_verifier + code_challenge (S256)
 *   2. Start a local loopback HTTP server for the callback
 *   3. Build authorize URL and open in browser via vscode.env.openExternal
 *   4. Receive authorization code on loopback server callback
 *   5. Exchange code for tokens at /oidc/token endpoint
 *   6. Store tokens via OIDCTokenStorage
 *
 * Uses a local HTTP server on 127.0.0.1 (RFC 8252 §7.3) instead of
 * custom protocol handlers (vscode://) for reliable cross-browser support.
 *
 * @module OIDCAuthCodeFlow
 */
import * as vscode from "vscode";
import { randomBytes, createHash } from "crypto";
import type { OIDCTokens, OIDCTokenResponse } from "./OIDCDeviceFlowAuth";
import { OIDCLoopbackServer } from "./OIDCLoopbackServer";

// ─── Constants ───────────────────────────────────────────────────────────────

const OIDC_SCOPES = "openid profile email offline_access";
const AUTHORIZE_PATH = "/authorize";
const TOKEN_PATH = "/token";
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

// ─── PKCE Helpers ────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random PKCE code_verifier.
 * Per RFC 7636, must be 43-128 characters from [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~".
 * We use 64 bytes of randomness, base64url-encoded (yields 86 chars).
 */
function generateCodeVerifier(): string {
  return randomBytes(64).toString("base64url");
}

/**
 * Generate S256 code_challenge from a code_verifier.
 * code_challenge = BASE64URL(SHA256(code_verifier))
 */
function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Generate a cryptographically random state parameter for CSRF protection.
 */
function generateState(): string {
  return randomBytes(32).toString("base64url");
}

// ─── Main Class ──────────────────────────────────────────────────────────────

/**
 * Manages OIDC Authorization Code + PKCE flow against the Konveyor Hub
 * builtin OIDC provider.
 *
 * Uses a local loopback HTTP server (RFC 8252) to receive the auth callback,
 * which is more reliable than vscode:// protocol handlers across browsers.
 */
export class OIDCAuthCodeFlow {
  private readonly issuerUrl: string;
  private readonly clientId: string;
  private readonly customFetch: typeof fetch;

  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt: number | null = null;

  /**
   * @param issuerUrl    Hub's OIDC issuer URL (e.g. "https://hub.example.com/oidc")
   * @param clientId     Registered OIDC client ID (e.g. "kai-ide")
   * @param customFetch  Optional fetch override (for insecure TLS, etc.)
   */
  constructor(
    issuerUrl: string,
    clientId: string,
    customFetch?: typeof fetch,
  ) {
    this.issuerUrl = issuerUrl.replace(/\/$/, "");
    this.clientId = clientId;
    this.customFetch = customFetch ?? fetch;
  }

  // ─── Token State ───────────────────────────────────────────────────────────

  /**
   * Restore tokens from persistent storage (call on startup).
   */
  public setTokens(tokens: OIDCTokens): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.expiresAt = tokens.expiresAt;
  }

  /**
   * Get current tokens for persistence to storage.
   */
  public getTokens(): OIDCTokens | null {
    if (!this.accessToken) {
      return null;
    }
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      expiresAt: this.expiresAt,
    };
  }

  /**
   * Get the Authorization header value.
   */
  public getHeader(): string | null {
    if (!this.accessToken) {
      return null;
    }
    return `Bearer ${this.accessToken}`;
  }

  /**
   * Whether any token is stored (may be expired).
   */
  public hasToken(): boolean {
    return !!this.accessToken;
  }

  /**
   * Whether the current access token is likely still valid.
   */
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
   * Get milliseconds until token needs refresh (for scheduling).
   */
  public getTimeUntilRefresh(): number {
    if (!this.expiresAt) {
      return 0;
    }
    const remaining = this.expiresAt - TOKEN_EXPIRY_BUFFER_MS - Date.now();
    return Math.max(0, remaining);
  }

  /**
   * Clear all stored tokens (for logout/disconnect).
   */
  public clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAt = null;
  }

  // ─── Authentication Flows ──────────────────────────────────────────────────

  /**
   * Full login flow: try refresh first, fall back to auth code flow.
   */
  public async login(cancellationToken?: vscode.CancellationToken): Promise<OIDCTokens> {
    // Try refresh first if we have a refresh token
    if (this.refreshToken) {
      const refreshed = await this.refresh();
      if (refreshed) {
        return this.getTokens()!;
      }
    }

    // Fall back to full authorization code flow
    return this.authCodeLogin(cancellationToken);
  }

  /**
   * Refresh the access token using the stored refresh token.
   * @returns true if refresh succeeded, false if re-login is needed.
   */
  public async refresh(): Promise<boolean> {
    if (!this.refreshToken) {
      return false;
    }

    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: this.clientId,
    });

    try {
      const response = await this.customFetch(`${this.issuerUrl}${TOKEN_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        // Refresh token expired or revoked
        this.refreshToken = null;
        return false;
      }

      const data = (await response.json()) as OIDCTokenResponse;
      this.updateTokensFromResponse(data);
      return true;
    } catch {
      // Network error — don't clear refresh token, might work later
      return false;
    }
  }

  /**
   * Initiate Authorization Code + PKCE flow using a loopback server.
   *
   * 1. Start local HTTP server on random port
   * 2. Generate PKCE verifier + challenge
   * 3. Open browser to authorize endpoint with redirect_uri pointing to loopback
   * 4. Receive callback on loopback server
   * 5. Exchange code for tokens
   * 6. Stop loopback server
   */
  public async authCodeLogin(cancellationToken?: vscode.CancellationToken): Promise<OIDCTokens> {
    const server = new OIDCLoopbackServer();
    let timeoutHandle: NodeJS.Timeout | undefined;

    try {
      // Step 1: Start loopback server
      await server.start();
      const redirectUri = server.getRedirectUri();

      // Step 2: Generate PKCE parameters
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);
      const state = generateState();

      // Register state with server for CSRF validation
      server.setExpectedState(state);

      // Step 3: Build authorize URL with loopback redirect
      const authorizeUrl = this.buildAuthorizeUrl(codeChallenge, state, redirectUri);

      // Set up timeout
      timeoutHandle = setTimeout(() => {
        server.abort(new OIDCAuthCodeTimeoutError());
      }, AUTH_CALLBACK_TIMEOUT_MS);

      // Handle cancellation
      if (cancellationToken) {
        cancellationToken.onCancellationRequested(() => {
          server.abort(new OIDCAuthCodeCancelledError());
        });
      }

      // Step 4: Open browser
      const opened = await vscode.env.openExternal(vscode.Uri.parse(authorizeUrl));
      if (!opened) {
        throw new OIDCAuthCodeError(
          "Failed to open browser for authentication. Please try again.",
          "browser_open_failed",
        );
      }

      // Show progress notification
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
          return server.waitForCallback().then(() => {}).catch(() => {});
        },
      );

      // Step 5: Wait for callback
      const result = await server.waitForCallback();

      // Step 6: Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(result.code, codeVerifier, redirectUri);

      vscode.window.showInformationMessage("Successfully signed in to Konveyor Hub");

      return tokens;
    } finally {
      // Always clean up
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      await server.stop().catch(() => {});
    }
  }

  // ─── Private: Authorization ────────────────────────────────────────────────

  /**
   * Build the OIDC authorize endpoint URL with PKCE parameters.
   */
  private buildAuthorizeUrl(codeChallenge: string, state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: OIDC_SCOPES,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state: state,
    });

    return `${this.issuerUrl}${AUTHORIZE_PATH}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens at the token endpoint.
   */
  private async exchangeCodeForTokens(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<OIDCTokens> {
    const params = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: redirectUri,
      client_id: this.clientId,
      code_verifier: codeVerifier,
    });

    const response = await this.customFetch(`${this.issuerUrl}${TOKEN_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new OIDCAuthCodeError(
        `Token exchange failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
        "token_exchange_failed",
      );
    }

    const data = (await response.json()) as OIDCTokenResponse;
    this.updateTokensFromResponse(data);
    return this.getTokens()!;
  }

  // ─── Private: Helpers ──────────────────────────────────────────────────────

  /**
   * Update internal token state from a successful token response.
   */
  private updateTokensFromResponse(data: OIDCTokenResponse): void {
    this.accessToken = data.access_token;

    if (data.refresh_token) {
      this.refreshToken = data.refresh_token;
    }

    if (data.expires_in) {
      this.expiresAt = Date.now() + data.expires_in * 1000;
    } else {
      this.expiresAt = this.extractExpiryFromJWT(data.access_token);
    }
  }

  /**
   * Extract exp claim from a JWT (without verification — just for scheduling).
   */
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
      // Not a valid JWT — that's ok
    }
    return null;
  }

  /**
   * Dispose of all resources.
   */
  public dispose(): void {
    // No persistent resources to clean up with loopback approach
  }
}
