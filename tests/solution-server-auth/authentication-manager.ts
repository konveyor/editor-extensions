import { generateRandomString } from '../e2e/utilities/utils';
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/**
 * Ratio of token lifetime at which to trigger refresh.
 * Set to 0.7 (70%) to refresh tokens before expiration, providing a safety buffer
 * to avoid requests failing due to token expiry during the refresh window.
 *
 * Example: For a 100s token, refresh will occur at 70s.
 */
const TOKEN_EXPIRY_RATIO = 0.7;

/**
 * Manages OAuth2 authentication and automatic token refresh for API requests.
 *
 * Features:
 * - Password grant authentication flow
 * - Automatic token refresh before expiration
 * - Refresh token rotation support
 * - Concurrent request protection during token refresh
 * - Local development mode bypass
 */
export class AuthenticationManager {
  private bearerToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private tokenPromise: Promise<void> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly realm: string,
    private readonly username: string,
    private readonly password: string,
    private readonly isLocal: boolean
  ) {}

  /**
   * Performs initial authentication using password grant flow.
   *
   * when using the local server it sets a mock token from environment variable.
   * when using the remote server it exchanges username/password for access and refresh tokens.
   */
  private async authenticate(): Promise<void> {
    if (this.isLocal) {
      this.bearerToken = this.bearerToken || generateRandomString();
      return;
    }

    const tokenUrl = this.getTokenUrl();
    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', `${this.realm}-ui`);
    params.append('username', this.username);
    params.append('password', this.password);

    const tokenData = await this.fetchToken(tokenUrl, params);
    this.setTokenData(tokenData);
  }
  public async getBearerToken(forceRefresh = false): Promise<string> {
    if (forceRefresh) {
      this.tokenExpiresAt = 0;
    }
    await this.ensureAuthenticated();
    if (!this.bearerToken) {
      throw new Error('Authentication failed: no token available');
    }
    return this.bearerToken;
  }

  private startAutoRefresh(): void {
    if (this.isLocal || !this.tokenExpiresAt || !this.refreshToken) {
      return;
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    const timeUntilRefresh = this.tokenExpiresAt - Date.now();
    this.refreshTimer = setTimeout(
      async () => {
        try {
          await this.ensureAuthenticated();
        } catch (error) {
          console.error('Auto-refresh failed:', error);
        }
      },
      Math.max(0, timeUntilRefresh)
    );
  }

  private stopAutoRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async refreshTokenFlow(): Promise<void> {
    if (this.isLocal) return;

    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }
    const tokenUrl = this.getTokenUrl();
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', `${this.realm}-ui`);
    params.append('refresh_token', this.refreshToken);
    const tokenData = await this.fetchToken(tokenUrl, params);
    this.setTokenData(tokenData);
  }

  private setTokenData(tokenData: TokenResponse): void {
    this.bearerToken = tokenData.access_token;
    this.refreshToken = tokenData.refresh_token || this.refreshToken;
    this.tokenExpiresAt = Date.now() + tokenData.expires_in * 1000 * TOKEN_EXPIRY_RATIO;
    this.startAutoRefresh();
  }

  private getTokenUrl(): string {
    const url = new URL(this.baseUrl);
    return `${url.protocol}//${url.host}/auth/realms/${this.realm}/protocol/openid-connect/token`;
  }

  private async fetchToken(tokenUrl: string, params: URLSearchParams): Promise<TokenResponse> {
    const controller = new AbortController();
    const timeoutMs = 10000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params,
        signal: controller.signal,
      });

      if (!response.ok) {
        const msg = await response.text();
        throw new Error(`Token request failed: ${response.status} ${msg}`);
      }

      return (await response.json()) as TokenResponse;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Token request timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
  private hasValidToken(): boolean {
    return (
      this.bearerToken !== null && this.tokenExpiresAt !== null && Date.now() < this.tokenExpiresAt
    );
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.tokenPromise) {
      return this.tokenPromise;
    }
    if (this.hasValidToken()) {
      return;
    }
    if (!this.refreshToken || this.isLocal) {
      this.tokenPromise = this.authenticate().finally(() => {
        this.tokenPromise = null;
      });
      return this.tokenPromise;
    }
    this.tokenPromise = this.refreshTokenFlow()
      .catch(() => this.authenticate())
      .finally(() => {
        this.tokenPromise = null;
      });

    return this.tokenPromise;
  }

  public dispose(): void {
    this.stopAutoRefresh();
    this.tokenPromise = null
    this.bearerToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = null;
  }
}
