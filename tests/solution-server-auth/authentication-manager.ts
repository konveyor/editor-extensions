interface TokenResponse {
  token: string;
  // RFC3339 timestamp at which the API key expires.
  expiration?: string;
  // Lifespan in hours (matches the hub's PAT struct).
  lifespan?: number;
}

const DEFAULT_TOKEN_LIFESPAN_SECONDS = 60 * 60;
const TOKEN_EXPIRY_RATIO = 0.7;

export class AuthenticationManager {
  private readonly previousTlsRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  private bearerToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private tokenPromise: Promise<void> | null = null;

  constructor(
    private readonly baseUrl: string,
    _realm: string,
    private readonly username: string,
    private readonly password: string,
    private readonly insecure: boolean = true
  ) {
    if (this.insecure) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  private async authenticate(): Promise<void> {
    const tokenUrl = this.getTokenUrl();
    const tokenData = await this.fetchToken(tokenUrl);
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
    if (!this.tokenExpiresAt) {
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

  private setTokenData(tokenData: TokenResponse): void {
    this.bearerToken = tokenData.token;
    this.tokenExpiresAt = Date.now() + this.tokenLifespanMs(tokenData) * TOKEN_EXPIRY_RATIO;
    this.startAutoRefresh();
  }

  private tokenLifespanMs(tokenData: TokenResponse): number {
    if (tokenData.expiration) {
      const expiresAt = Date.parse(tokenData.expiration);
      if (Number.isFinite(expiresAt)) {
        return Math.max(1000, expiresAt - Date.now());
      }
    }
    if (typeof tokenData.lifespan === 'number' && Number.isFinite(tokenData.lifespan)) {
      return Math.max(1000, tokenData.lifespan * 60 * 60 * 1000);
    }
    return DEFAULT_TOKEN_LIFESPAN_SECONDS * 1000;
  }

  private getTokenUrl(): string {
    const url = new URL(this.baseUrl);
    return `${url.protocol}//${url.host}/hub/auth/tokens`;
  }

  private basicAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
  }

  private async fetchToken(tokenUrl: string): Promise<TokenResponse> {
    const timeoutMs = 10000;
    if (this.insecure && tokenUrl.startsWith('https://')) {
      return this.fetchTokenInsecure(tokenUrl, timeoutMs);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: this.basicAuthHeader(),
        },
        body: '{}',
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

  private async fetchTokenInsecure(tokenUrl: string, timeoutMs: number): Promise<TokenResponse> {
    const https = await import('https');
    const { URL } = await import('url');

    const parsedUrl = new URL(tokenUrl);
    const postData = '{}';

    return new Promise((resolve, reject) => {
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          Accept: 'application/json',
          Authorization: this.basicAuthHeader(),
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
    this.tokenPromise = this.authenticate().finally(() => {
      this.tokenPromise = null;
    });
    return this.tokenPromise;
  }

  public dispose(): void {
    this.stopAutoRefresh();
    if (this.insecure) {
      if (this.previousTlsRejectUnauthorized === undefined) {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      } else {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = this.previousTlsRejectUnauthorized;
      }
    }
    this.tokenPromise = null;
    this.bearerToken = null;
    this.tokenExpiresAt = null;
  }
}
