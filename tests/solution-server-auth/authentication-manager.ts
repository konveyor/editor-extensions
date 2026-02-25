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
    private readonly insecure: boolean = false
  ) {
    if (this.insecure) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  /**
   * Performs initial authentication using password grant flow.
   *
   * Exchanges username/password for access and refresh tokens.
   */
  private async authenticate(): Promise<void> {
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
    if (!this.tokenExpiresAt || !this.refreshToken) {
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
    const timeoutMs = 10000;
    if (this.insecure && tokenUrl.startsWith('https://')) {
      return this.fetchTokenInsecure(tokenUrl, params, timeoutMs);
    }

    const controller = new AbortController();
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

  private async fetchTokenInsecure(
    tokenUrl: string,
    params: URLSearchParams,
    timeoutMs: number
  ): Promise<TokenResponse> {
    const https = await import('https');
    const { URL } = await import('url');

    const parsedUrl = new URL(tokenUrl);
    const postData = params.toString();

    return new Promise((resolve, reject) => {
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          Accept: 'application/json',
        },
        rejectUnauthorized: false, // Disable certificate verification
        timeout: timeoutMs,
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const jsonData = JSON.parse(data) as TokenResponse;
              resolve(jsonData);
            } catch (error) {
              reject(new Error(`Failed to parse JSON response: ${error}`));
            }
          } else {
            reject(new Error(`Token request failed: ${res.statusCode} ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Token request timed out after ${timeoutMs}ms`));
      });

      req.write(postData);
      req.end();
    });
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
    if (!this.refreshToken) {
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
