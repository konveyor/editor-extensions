/**
 * OIDC Device Flow Authentication for Konveyor Hub.
 *
 * Implements RFC 8628 (Device Authorization Grant) against the hub's
 * builtin OIDC provider (PR #1042). This is a TypeScript port of
 * the reference Go client in `shared/binding/auth/bearer.go`.
 *
 * Flow:
 *   1. POST /oidc/device_authorization → get device_code + user_code
 *   2. Show user_code via VS Code notification, open verification_uri in browser
 *   3. Poll POST /oidc/token until user completes auth or timeout
 *   4. Store tokens via OIDCTokenStorage for persistence
 *
 * @module OIDCDeviceFlowAuth
 */
import * as vscode from "vscode";

// ─── Constants ───────────────────────────────────────────────────────────────

const OIDC_SCOPES = "openid profile email offline_access";
const DEVICE_AUTH_PATH = "/device_authorization";
const TOKEN_PATH = "/token";
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const TOKEN_EXPIRY_BUFFER_MS = 30_000; // 30s before actual expiry

// OAuth 2.0 device flow error codes (RFC 8628 §3.5)
const ERROR_AUTHORIZATION_PENDING = "authorization_pending";
const ERROR_SLOW_DOWN = "slow_down";
const ERROR_EXPIRED_TOKEN = "expired_token";
const ERROR_ACCESS_DENIED = "access_denied";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Response from the device authorization endpoint. */
export interface DeviceAuthorizationResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

/** Successful token response from the token endpoint. */
export interface OIDCTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

/** Error response from the token endpoint. */
export interface OIDCTokenErrorResponse {
  error: string;
  error_description?: string;
}

/** Persisted token set. */
export interface OIDCTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null; // Unix ms when token expires
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export class OIDCDeviceFlowError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "OIDCDeviceFlowError";
  }
}

export class OIDCDeviceFlowCancelledError extends OIDCDeviceFlowError {
  constructor() {
    super("Device flow authentication was cancelled", "cancelled");
    this.name = "OIDCDeviceFlowCancelledError";
  }
}

export class OIDCDeviceFlowExpiredError extends OIDCDeviceFlowError {
  constructor() {
    super("Device code has expired. Please try again.", ERROR_EXPIRED_TOKEN);
    this.name = "OIDCDeviceFlowExpiredError";
  }
}

export class OIDCDeviceFlowDeniedError extends OIDCDeviceFlowError {
  constructor() {
    super("Authorization was denied by the user.", ERROR_ACCESS_DENIED);
    this.name = "OIDCDeviceFlowDeniedError";
  }
}

// ─── Main Class ──────────────────────────────────────────────────────────────

/**
 * Manages OIDC Device Flow authentication against the Konveyor Hub
 * builtin OIDC provider.
 */
export class OIDCDeviceFlowAuth {
  private readonly issuerUrl: string;
  private readonly clientId: string;
  private readonly customFetch: typeof fetch;

  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt: number | null = null;

  /**
   * @param issuerUrl Hub's OIDC issuer URL (e.g. "https://hub.example.com/oidc")
   * @param clientId  Registered OIDC client ID (e.g. "konveyor-vscode")
   * @param customFetch Optional fetch override (for insecure TLS, etc.)
   */
  constructor(issuerUrl: string, clientId: string, customFetch?: typeof fetch) {
    // Normalize: strip trailing slash
    this.issuerUrl = issuerUrl.replace(/\/$/, "");
    this.clientId = clientId;
    this.customFetch = customFetch ?? fetch;
  }

  // ─── Token State ─────────────────────────────────────────────────────────

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
   * @returns "Bearer <token>" or null if not authenticated.
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
   * Uses a 30-second buffer before actual expiry.
   */
  public isTokenValid(): boolean {
    if (!this.accessToken) {
      return false;
    }
    if (!this.expiresAt) {
      // If we have a token but no expiry, assume valid
      return true;
    }
    return Date.now() < this.expiresAt - TOKEN_EXPIRY_BUFFER_MS;
  }

  /**
   * Get milliseconds until token needs refresh (for scheduling).
   * Returns 0 if already expired or no expiry info.
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

  // ─── Authentication Flows ────────────────────────────────────────────────

  /**
   * Full login flow: try refresh first, fall back to device flow.
   *
   * @param cancellationToken VS Code cancellation token for user abort.
   * @returns Tokens on success.
   * @throws OIDCDeviceFlowError on failure.
   */
  public async login(cancellationToken?: vscode.CancellationToken): Promise<OIDCTokens> {
    // Try refresh first if we have a refresh token
    if (this.refreshToken) {
      const refreshed = await this.refresh();
      if (refreshed) {
        return this.getTokens()!;
      }
    }

    // Fall back to full device login
    return this.deviceLogin(cancellationToken);
  }

  /**
   * Refresh the access token using the stored refresh token.
   *
   * @returns true if refresh succeeded, false if device login is needed.
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
        // Refresh token expired or revoked — need device login
        this.refreshToken = null;
        return false;
      }

      const data: OIDCTokenResponse = await response.json();
      this.updateTokensFromResponse(data);
      return true;
    } catch {
      // Network error — don't clear refresh token, might work later
      return false;
    }
  }

  /**
   * Initiate RFC 8628 device authorization flow.
   *
   * Shows user_code in a VS Code notification, opens the verification URI
   * in the user's browser, then polls the token endpoint until authorization
   * is complete.
   *
   * @param cancellationToken VS Code cancellation token for user abort.
   * @returns Tokens on success.
   * @throws OIDCDeviceFlowCancelledError if user cancels.
   * @throws OIDCDeviceFlowExpiredError if device code expires.
   * @throws OIDCDeviceFlowDeniedError if user denies.
   * @throws OIDCDeviceFlowError on other failures.
   */
  public async deviceLogin(cancellationToken?: vscode.CancellationToken): Promise<OIDCTokens> {
    // Step 1: Request device authorization
    const deviceAuth = await this.requestDeviceAuthorization();

    // Step 2: Present code to user and open browser
    await this.presentDeviceCode(deviceAuth);

    // Step 3: Poll for tokens
    const tokens = await this.pollForTokens(deviceAuth, cancellationToken);

    return tokens;
  }

  // ─── Private: Device Authorization ───────────────────────────────────────

  /**
   * POST to device_authorization endpoint to get device_code + user_code.
   */
  private async requestDeviceAuthorization(): Promise<DeviceAuthorizationResponse> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      scope: OIDC_SCOPES,
    });

    const response = await this.customFetch(`${this.issuerUrl}${DEVICE_AUTH_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new OIDCDeviceFlowError(
        `Device authorization request failed: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`,
      );
    }

    return (await response.json()) as DeviceAuthorizationResponse;
  }

  /**
   * Show user_code in VS Code UI and open verification URI in browser.
   */
  private async presentDeviceCode(deviceAuth: DeviceAuthorizationResponse): Promise<void> {
    const verificationUri =
      deviceAuth.verification_uri_complete ?? deviceAuth.verification_uri;

    // Copy code to clipboard proactively
    await vscode.env.clipboard.writeText(deviceAuth.user_code);

    // Show notification with actions
    const action = await vscode.window.showInformationMessage(
      `Sign in to Konveyor Hub\n\nCode: ${deviceAuth.user_code} (copied to clipboard)`,
      { modal: false },
      "Open Browser",
      "Copy Code",
    );

    if (action === "Open Browser") {
      await vscode.env.openExternal(vscode.Uri.parse(verificationUri));
    } else if (action === "Copy Code") {
      await vscode.env.clipboard.writeText(deviceAuth.user_code);
    }

    // Also open browser automatically for best UX
    if (action !== "Open Browser") {
      await vscode.env.openExternal(vscode.Uri.parse(verificationUri));
    }
  }

  /**
   * Poll the token endpoint until authorization completes, expires, or is cancelled.
   */
  private async pollForTokens(
    deviceAuth: DeviceAuthorizationResponse,
    cancellationToken?: vscode.CancellationToken,
  ): Promise<OIDCTokens> {
    let interval = deviceAuth.interval * 1000; // Convert to ms
    const deadline = Date.now() + deviceAuth.expires_in * 1000;

    while (Date.now() < deadline) {
      // Check for cancellation
      if (cancellationToken?.isCancellationRequested) {
        throw new OIDCDeviceFlowCancelledError();
      }

      // Wait for the polling interval
      await this.sleep(interval, cancellationToken);

      // Check cancellation again after sleep
      if (cancellationToken?.isCancellationRequested) {
        throw new OIDCDeviceFlowCancelledError();
      }

      // Poll token endpoint
      const params = new URLSearchParams({
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceAuth.device_code,
        client_id: this.clientId,
      });

      let response: Response;
      try {
        response = await this.customFetch(`${this.issuerUrl}${TOKEN_PATH}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: params.toString(),
        });
      } catch {
        // Network error during poll — continue polling
        continue;
      }

      if (response.ok) {
        // Success! We got tokens.
        const data: OIDCTokenResponse = await response.json();
        this.updateTokensFromResponse(data);
        vscode.window.showInformationMessage("Successfully signed in to Konveyor Hub");
        return this.getTokens()!;
      }

      // Handle error responses
      const errorData: OIDCTokenErrorResponse = await response.json().catch(() => ({
        error: "unknown",
        error_description: `HTTP ${response.status}`,
      }));

      switch (errorData.error) {
        case ERROR_AUTHORIZATION_PENDING:
          // User hasn't completed auth yet — keep polling
          continue;

        case ERROR_SLOW_DOWN:
          // Server wants us to slow down — increase interval by 5s (per RFC 8628 §3.5)
          interval += 5000;
          continue;

        case ERROR_EXPIRED_TOKEN:
          throw new OIDCDeviceFlowExpiredError();

        case ERROR_ACCESS_DENIED:
          throw new OIDCDeviceFlowDeniedError();

        default:
          throw new OIDCDeviceFlowError(
            `Token polling failed: ${errorData.error}${errorData.error_description ? ` - ${errorData.error_description}` : ""}`,
            errorData.error,
          );
      }
    }

    // If we exit the loop, the device code expired
    throw new OIDCDeviceFlowExpiredError();
  }

  // ─── Private: Helpers ────────────────────────────────────────────────────

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
      // Try to extract expiry from JWT
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
        return payload.exp * 1000; // Convert to ms
      }
    } catch {
      // Not a valid JWT or can't decode — that's ok
    }
    return null;
  }

  /**
   * Sleep for a duration, respecting cancellation.
   */
  private sleep(ms: number, cancellationToken?: vscode.CancellationToken): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);

      if (cancellationToken) {
        const disposable = cancellationToken.onCancellationRequested(() => {
          clearTimeout(timer);
          disposable.dispose();
          resolve();
        });
      }
    });
  }
}
