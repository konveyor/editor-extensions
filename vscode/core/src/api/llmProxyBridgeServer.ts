/**
 * LLM Proxy Bridge Server: A lightweight HTTP reverse proxy on localhost
 * that forwards OpenAI-compatible API requests from agent subprocesses
 * (Goose, OpenCode) to the Hub LLM proxy, dynamically injecting the
 * current bearer token on each request.
 *
 * This solves the token lifecycle problem: agent subprocesses receive
 * credentials via environment variables at startup, but Hub bearer tokens
 * expire and get refreshed. By proxying through the extension process,
 * the bridge always uses the latest token from HubConnectionManager.
 *
 * The bridge also handles Hub TLS configuration (custom CA bundles,
 * insecure mode) via the scoped fetch function, so agent subprocesses
 * don't need any TLS setup.
 */

import * as http from "http";
import winston from "winston";

export interface LlmProxyBridgeServerConfig {
  /** Called on each request to get the current bearer token. Never stale. */
  getBearerToken: () => string | null;
  /** Whether Hub auth is enabled (controls behavior when token is null). */
  isAuthEnabled: () => boolean;
  /** The upstream Hub LLM proxy endpoint, e.g. "https://hub.example.com/llm-proxy/v1" */
  proxyEndpoint: string;
  /** Hub's scoped fetch for TLS config (insecure/CA bundle). undefined = use global fetch. */
  scopedFetch?: typeof fetch;
  /** Winston logger */
  logger: winston.Logger;
}

export class LlmProxyBridgeServer {
  private server: http.Server | null = null;
  private port: number | null = null;
  private readonly config: LlmProxyBridgeServerConfig;
  private readonly logger: winston.Logger;

  constructor(config: LlmProxyBridgeServerConfig) {
    this.config = config;
    this.logger = config.logger;
  }

  /**
   * Start the bridge server on a random available port.
   * Returns the port number.
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.logger.error(`LlmProxyBridge: unhandled error: ${err}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                message: "Internal proxy error",
                type: "proxy_error",
                code: "internal_error",
              },
            }),
          );
        });
      });

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
          this.logger.info(`LlmProxyBridge: listening on 127.0.0.1:${this.port}`);
          resolve(this.port);
        } else {
          reject(new Error("LlmProxyBridge: failed to get server address"));
        }
      });

      this.server.on("error", (err) => {
        this.logger.error(`LlmProxyBridge: server error: ${err.message}`);
        reject(err);
      });
    });
  }

  getPort(): number | null {
    return this.port;
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.logger.info("LlmProxyBridge: stopped");
          this.server = null;
          this.port = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  dispose(): void {
    this.stop().catch(() => {});
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method || "GET";

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });
      res.end();
      return;
    }

    // Health check
    const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    if (pathname === "/health" || pathname === "/v1/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Check auth availability
    const token = this.config.getBearerToken();
    if (!token && this.config.isAuthEnabled()) {
      res.writeHead(502, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(
        JSON.stringify({
          error: {
            message:
              "Hub authentication token is not available. The Hub connection may have been lost.",
            type: "proxy_error",
            code: "hub_auth_unavailable",
          },
        }),
      );
      return;
    }

    const body = await this.readBody(req);
    this.logger.debug("LlmProxyBridge: forwarding request", {
      method: req.method,
      path: pathname,
      hasToken: !!token,
      bodyLength: body.length,
    });
    await this.forwardRequest(req, token, body, res);
  }

  private async forwardRequest(
    req: http.IncomingMessage,
    token: string | null,
    body: Buffer,
    res: http.ServerResponse,
  ): Promise<void> {
    const fetchFn = this.config.scopedFetch ?? globalThis.fetch;

    // Build upstream URL: strip /v1 prefix since proxyEndpoint already has it
    const incomingPath = new URL(req.url || "/", "http://127.0.0.1").pathname;
    let relativePath = incomingPath;
    if (relativePath.startsWith("/v1/")) {
      relativePath = relativePath.slice(3); // "/v1/chat/completions" -> "/chat/completions"
    } else if (relativePath === "/v1") {
      relativePath = "/";
    }
    const upstreamUrl = this.config.proxyEndpoint + relativePath;

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": req.headers["content-type"] || "application/json",
    };
    if (req.headers["accept"]) {
      headers["Accept"] = req.headers["accept"] as string;
    }
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    try {
      const upstreamResponse = await fetchFn(upstreamUrl, {
        method: req.method || "POST",
        headers,
        body: body.length > 0 ? body : undefined,
      });

      const statusCode = upstreamResponse.status;
      const contentType = upstreamResponse.headers.get("content-type");
      const isStreaming = contentType?.includes("text/event-stream");

      this.logger.debug("LlmProxyBridge: upstream responded", {
        status: statusCode,
        streaming: !!isStreaming,
        upstream: upstreamUrl,
      });

      // Build response headers
      const responseHeaders: Record<string, string> = {
        "Access-Control-Allow-Origin": "*",
      };

      if (contentType) {
        responseHeaders["Content-Type"] = contentType;
      }
      const cacheControl = upstreamResponse.headers.get("cache-control");
      if (cacheControl) {
        responseHeaders["Cache-Control"] = cacheControl;
      }

      if (isStreaming && upstreamResponse.body) {
        // SSE streaming: pipe chunks directly
        res.writeHead(statusCode, responseHeaders);

        const reader = (upstreamResponse.body as ReadableStream<Uint8Array>).getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            const canContinue = res.write(value);
            if (!canContinue) {
              await new Promise<void>((resolve) => res.once("drain", resolve));
            }
          }
        } catch (streamError) {
          this.logger.error(`LlmProxyBridge: stream error: ${streamError}`);
        } finally {
          res.end();
        }
      } else {
        // Non-streaming: read full response and forward
        const responseBody = await upstreamResponse.arrayBuffer();
        res.writeHead(statusCode, responseHeaders);
        res.end(Buffer.from(responseBody));
      }
    } catch (fetchError) {
      this.logger.error(`LlmProxyBridge: upstream fetch error: ${fetchError}`);
      res.writeHead(502, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(
        JSON.stringify({
          error: {
            message: `Failed to reach Hub LLM proxy: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
            type: "proxy_error",
            code: "hub_unreachable",
          },
        }),
      );
    }
  }

  private readBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }
}
