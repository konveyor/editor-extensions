import tls from "node:tls";
import fs from "fs/promises";
import { Agent as HttpsAgent, type AgentOptions } from "node:https";
import { Agent as UndiciAgent, ProxyAgent } from "undici";
import type { Dispatcher as UndiciTypesDispatcher } from "undici-types";
import { NodeHttpHandler, NodeHttp2Handler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { Logger } from "winston";

/**
 * Creates an undici dispatcher for fetch-based HTTP clients.
 * Used by: OpenAI, Azure OpenAI, Ollama, DeepSeek
 *
 * @param allowH2 - Enable HTTP/2 support in undici client and proxy
 */
export async function getDispatcherWithCertBundle(
  bundlePath: string | undefined,
  insecure: boolean = false,
  allowH2: boolean = false,
): Promise<UndiciTypesDispatcher> {
  let allCerts: string | undefined;
  if (bundlePath) {
    const defaultCerts = tls.rootCertificates.join("\n");
    const certs = await fs.readFile(bundlePath, "utf8");
    allCerts = [defaultCerts, certs].join("\n");
  }

  // Check for proxy configuration
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (proxyUrl) {
    // Use ProxyAgent when proxy is configured
    return new ProxyAgent({
      uri: proxyUrl,
      allowH2, // Pass through HTTP/2 preference!
      connect: {
        ca: allCerts,
        rejectUnauthorized: !insecure,
      },
    }) as unknown as UndiciTypesDispatcher;
  }

  return new UndiciAgent({
    connect: {
      ca: allCerts,
      rejectUnauthorized: !insecure,
    },
    allowH2,
  }) as unknown as UndiciTypesDispatcher;
}

export async function getHttpsAgentWithCertBundle(
  bundlePath: string | undefined,
  insecure: boolean = false,
): Promise<HttpsAgent> {
  let allCerts: string | undefined;
  if (bundlePath) {
    const defaultCerts = tls.rootCertificates.join("\n");
    const certs = await fs.readFile(bundlePath, "utf8");
    allCerts = [defaultCerts, certs].join("\n");
  }

  return new HttpsAgent({
    ca: allCerts,
    rejectUnauthorized: !insecure,
  });
}

export function getFetchWithDispatcher(
  dispatcher: UndiciTypesDispatcher,
): (input: Request | URL | string, init?: RequestInit) => Promise<Response> {
  return (input: Request | URL | string, init?: RequestInit) => {
    return fetch(
      input as any,
      {
        ...(init || {}),
        dispatcher,
      } as any,
    );
  };
}

/**
 * Creates a Node.js HTTP handler for AWS SDK clients.
 * Used by: AWS Bedrock
 *
 * @param httpVersion - "1.1" for HTTP/1.1 (NodeHttpHandler) or "2.0" for HTTP/2 (NodeHttp2Handler)
 * See: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-smithy-node-http-handler/
 */
export async function getNodeHttpHandler(
  env: Record<string, string>,
  logger: Logger,
  httpVersion: "1.1" | "2.0" = "1.1",
): Promise<NodeHttpHandler | NodeHttp2Handler> {
  const caBundle = env["CA_BUNDLE"] || env["AWS_CA_BUNDLE"];
  const insecureRaw =
    env["ALLOW_INSECURE"] || env["NODE_TLS_REJECT_UNAUTHORIZED"] === "0" ? "true" : undefined;
  let insecure = false;
  if (insecureRaw && insecureRaw.match(/^(true|1)$/i)) {
    insecure = true;
  }

  let allCerts: string | undefined;
  if (caBundle) {
    try {
      const defaultCerts = tls.rootCertificates.join("\n");
      const certs = await fs.readFile(caBundle, "utf8");
      allCerts = [defaultCerts, certs].join("\n");
    } catch (error) {
      logger.error(error);
      throw new Error(`Failed to read CA bundle: ${String(error)}`);
    }
  }

  // Check for proxy configuration
  const proxyUrl =
    env["HTTPS_PROXY"] ||
    env["https_proxy"] ||
    env["HTTP_PROXY"] ||
    env["http_proxy"] ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  // Define proper type for agent options with ALPN support
  interface HttpsAgentOptionsWithALPN extends AgentOptions {
    ALPNProtocols?: string[];
  }

  const agentOptions: HttpsAgentOptionsWithALPN = {
    ca: allCerts,
    rejectUnauthorized: !insecure,
    // Set ALPN protocols based on HTTP version
    ALPNProtocols: httpVersion === "2.0" ? ["h2", "http/1.1"] : ["http/1.1"],
  };

  const handlerOptions = {
    requestTimeout: 30000,
    connectionTimeout: 5000,
    socketTimeout: 30000,
  };

  // Use proxy-aware agents if proxy is configured
  if (proxyUrl) {
    logger.info(`Using proxy ${proxyUrl} for AWS Bedrock`);

    if (httpVersion === "2.0") {
      // NodeHttp2Handler does not support custom agents/proxy in the same way
      // Fall back to HTTP/1.1 when proxy is configured for compatibility
      logger.warn(
        "HTTP/2 with proxy is not supported via NodeHttp2Handler. " +
          "Falling back to HTTP/1.1 with proxy support.",
      );
      const proxyAgent = new HttpsProxyAgent(proxyUrl, {
        ...agentOptions,
        ALPNProtocols: ["http/1.1"],
      });
      return new NodeHttpHandler({
        ...handlerOptions,
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent,
      });
    }

    const proxyAgent = new HttpsProxyAgent(proxyUrl, agentOptions);
    return new NodeHttpHandler({
      ...handlerOptions,
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent,
    });
  }

  // No proxy - use standard handlers
  if (httpVersion === "2.0") {
    logger.info("Using NodeHttp2Handler for HTTP/2");
    return new NodeHttp2Handler({
      ...handlerOptions,
    }) as any;
  }

  return new NodeHttpHandler({
    ...handlerOptions,
    httpAgent: new HttpsAgent(agentOptions),
    httpsAgent: new HttpsAgent(agentOptions),
  });
}
