interface TokenResponse {
  token: string;
  // RFC3339 timestamp at which the API key expires.
  expiration?: string;
  // Lifespan in hours (matches the hub's PAT struct).
  lifespan?: number;
}

const DEFAULT_TOKEN_LIFESPAN_SECONDS = 60 * 60;
const TOKEN_EXPIRY_RATIO = 0.7;

/** Maximum number of retry attempts for transient failures. */
const MAX_RETRY_ATTEMPTS = 3;
/** Base delay in ms for exponential backoff (2s, 4s). */
const RETRY_BASE_DELAY_MS = 2000;

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
    // Node's setTimeout stores its delay in a 32-bit signed int (max ~24.8 days).
    // Tokens with multi-year lifespans overflow to 1ms, spinning the refresh loop.
    const MAX_TIMER_MS = 2 ** 31 - 1;
    if (timeUntilRefresh > MAX_TIMER_MS) {
      return;
    }
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

  /**
   * Determine whether an error is transient (timeout or network) and
   * therefore eligible for retry. HTTP 4xx errors are NOT retried.
   */
  private isRetryableError(err: any): boolean {
    // Timeout errors
    if (err.name === 'AbortError') return true;
    if (err.message && /timed out/i.test(err.message)) return true;
    if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') return true;

    // Network errors
    if (err.code === 'ECONNREFUSED') return true;
    if (err.code === 'ECONNRESET') return true;
    if (err.code === 'ENOTFOUND') return true;
    if (err.code === 'EAI_AGAIN') return true;
    if (err.type === 'system') return true;

    return false;
  }

  private async fetchToken(tokenUrl: string): Promise<TokenResponse> {
    const timeoutMs = 30000;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.fetchTokenSecure(tokenUrl, timeoutMs);
      } catch (err: any) {
        lastError = err;

        // Don't retry on client errors (4xx) — only on transient failures
        if (!this.isRetryableError(err)) {
          throw err;
        }

        if (attempt < MAX_RETRY_ATTEMPTS) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(
            `Token fetch attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed (${err.message}). ` +
              `Retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  private async fetchTokenSecure(tokenUrl: string, timeoutMs: number): Promise<TokenResponse> {
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
        const error: any = new Error(`Token request failed: ${response.status} ${msg}`);
        error.statusCode = response.status;
        throw error;
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
