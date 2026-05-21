/**
 * Local loopback HTTP server for receiving OAuth/OIDC callbacks.
 *
 * Spins up a temporary HTTP server on 127.0.0.1 with a random port to
 * receive the authorization code callback from the OIDC provider.
 * This approach is more reliable than custom protocol handlers (vscode://)
 * because it works consistently across all browsers without protocol
 * permission prompts.
 *
 * Based on the pattern used by VS Code's built-in GitHub authentication
 * and recommended by RFC 8252 (OAuth for Native Apps) §7.3.
 *
 * @module OIDCLoopbackServer
 */
import * as http from "http";
import { URL } from "url";
import { randomBytes } from "crypto";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Fixed port for the loopback callback server.
 * Must match the redirect_uri registered with the OIDC client on Hub.
 * Using a fixed port avoids the need for wildcard redirect URI matching.
 */
const LOOPBACK_PORT = 45321;
const CALLBACK_PATH = "/callback";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OAuthCallbackResult {
  code: string;
  state: string;
}

// ─── Success Page HTML ───────────────────────────────────────────────────────

const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authentication Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #1a1a2e;
      color: #e0e0e0;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .checkmark {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #4fc3f7;
    }
    p {
      color: #9e9e9e;
      margin: 0.25rem 0;
    }
    .close-hint {
      margin-top: 1.5rem;
      font-size: 0.875rem;
      color: #757575;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✓</div>
    <h1>Authentication Successful</h1>
    <p>You have been signed in to Konveyor Hub.</p>
    <p class="close-hint">You can close this tab and return to VS Code.</p>
  </div>
  <script>
    // Redirect to vscode:// protocol to bring VS Code to foreground, then close tab
    setTimeout(function() {
      window.location = 'vscode://file';
      setTimeout(function() { window.close(); }, 1000);
    }, 1000);
  </script>
</body>
</html>`;

const ERROR_HTML = (errorMsg: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authentication Failed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #1a1a2e;
      color: #e0e0e0;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #ef5350;
    }
    p {
      color: #9e9e9e;
      margin: 0.25rem 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✗</div>
    <h1>Authentication Failed</h1>
    <p>${errorMsg}</p>
    <p>Please close this tab and try again in VS Code.</p>
  </div>
</body>
</html>`;

// ─── Server Class ────────────────────────────────────────────────────────────

/**
 * A loopback HTTP server that listens on 127.0.0.1 for OAuth callbacks.
 *
 * Usage:
 * ```ts
 * const server = new OIDCLoopbackServer();
 * const port = await server.start();
 * const redirectUri = server.getRedirectUri();
 * // ... open browser with authorize URL using this redirectUri ...
 * const result = await server.waitForCallback();
 * await server.stop();
 * ```
 */
export class OIDCLoopbackServer {
  private readonly server: http.Server;
  private readonly callbackPromise: Promise<OAuthCallbackResult>;
  private resolveCallback!: (result: OAuthCallbackResult) => void;
  private rejectCallback!: (error: Error) => void;
  private port: number | undefined;
  private readonly nonce: string;
  private expectedState: string | undefined;

  constructor() {
    this.nonce = randomBytes(16).toString("base64url");

    this.callbackPromise = new Promise<OAuthCallbackResult>((resolve, reject) => {
      this.resolveCallback = resolve;
      this.rejectCallback = reject;
    });

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });
  }

  /**
   * Start the server on a random available port.
   * @returns The port number the server is listening on.
   */
  public async start(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for loopback server to start"));
      }, 5000);

      this.server.on("listening", () => {
        const address = this.server.address();
        if (address && typeof address === "object") {
          this.port = address.port;
        } else {
          clearTimeout(timeout);
          reject(new Error("Unable to determine server port"));
          return;
        }
        clearTimeout(timeout);
        resolve(this.port);
      });

      this.server.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Loopback server failed to start: ${err.message}`));
      });

      // Listen on 127.0.0.1 with fixed port for redirect_uri matching
      this.server.listen(LOOPBACK_PORT, "127.0.0.1");
    });
  }

  /**
   * Stop the server and clean up.
   */
  public async stop(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get the redirect URI to use in the authorization request.
   * Must be called after start().
   */
  public getRedirectUri(): string {
    if (!this.port) {
      throw new Error("Server not started — call start() first");
    }
    return `http://127.0.0.1:${this.port}/callback`;
  }

  /**
   * Set the expected state parameter for CSRF validation.
   */
  public setExpectedState(state: string): void {
    this.expectedState = state;
  }

  /**
   * Wait for the OAuth callback to arrive.
   * Resolves with the authorization code and state.
   */
  public waitForCallback(): Promise<OAuthCallbackResult> {
    return this.callbackPromise;
  }

  /**
   * Reject the pending callback (e.g. on timeout or cancellation).
   */
  public abort(error: Error): void {
    this.rejectCallback(error);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const reqUrl = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);

    switch (reqUrl.pathname) {
      case CALLBACK_PATH:
        this.handleCallback(reqUrl, res);
        break;
      default:
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        break;
    }
  }

  private handleCallback(url: URL, res: http.ServerResponse): void {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    // Handle error response from OIDC provider
    if (error) {
      const msg = errorDescription ?? error;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(ERROR_HTML(msg));
      this.rejectCallback(new Error(`OIDC authorization error: ${msg}`));
      return;
    }

    // Validate required params
    if (!code || !state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(ERROR_HTML("Missing authorization code or state parameter."));
      this.rejectCallback(new Error("Missing code or state in callback"));
      return;
    }

    // Validate state if expected
    if (this.expectedState && state !== this.expectedState) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(ERROR_HTML("State parameter mismatch — possible CSRF attack."));
      this.rejectCallback(new Error("State mismatch in callback"));
      return;
    }

    // Success — serve the success page and resolve
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SUCCESS_HTML);
    this.resolveCallback({ code, state });
  }
}
