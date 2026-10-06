import tls from "node:tls";
import fs from "fs/promises";
import { Agent as HttpsAgent, type AgentOptions } from "node:https";
import { Agent as UndiciAgent, ProxyAgent, fetch as undiciFetch } from "undici";
import type { Dispatcher as UndiciTypesDispatcher } from "undici-types";
import { NodeHttpHandler, NodeHttp2Handler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { Logger } from "winston";
import { sanitizeUrl } from "./networkDiagnostics";

/**
 * Returns true if `targetUrl` should bypass any configured HTTP(S) proxy
 * according to the `NO_PROXY` value. Implements the comma-separated,
 * case-insensitive, suffix-style matching used by curl / requests /
 * proxy-from-env so users' shell-level expectations are honored.
 */
export function shouldBypassProxy(
  targetUrl: string | undefined,
  noProxy: string | undefined,
): boolean {
  if (!targetUrl || !noProxy) {
    return false;
  }

  let host: string;
  let port: string;
  try {
    const parsed = new URL(targetUrl);
    host = parsed.hostname.toLowerCase();
    port = parsed.port;
  } catch {
    return false;
  }
  if (!host) {
    return false;
  }

  const entries = noProxy
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  for (const entry of entries) {
    if (entry === "*") {
      return true;
    }

    const colonIdx = entry.lastIndexOf(":");
    let entryHost = entry;
    let entryPort = "";
    if (colonIdx >= 0 && !entry.startsWith("[")) {
      entryHost = entry.slice(0, colonIdx);
      entryPort = entry.slice(colonIdx + 1);
    }

    if (entryPort && entryPort !== port) {
      continue;
    }

    if (entryHost.startsWith(".")) {
      const suffix = entryHost;
      if (host.endsWith(suffix)) {
        return true;
      }
      continue;
    }

    if (host === entryHost) {
      return true;
    }
    if (host.endsWith("." + entryHost)) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve the effective proxy configuration for an outbound connection.
 *
 * `env` is the provider's merged environment (process env overlaid with the
 * `environment:` block from provider-settings.yaml). Passing it lets users
 * configure proxy behavior in that file, the same way `CA_BUNDLE` and
 * `ALLOW_INSECURE` already work. Callers with no provider context (the Hub)
 * omit it and get the process environment alone.
 */
export function resolveProxyEnv(env?: Record<string, string>): {
  proxyUrl?: string;
  noProxy?: string;
} {
  const source: Record<string, string | undefined> = { ...process.env, ...(env ?? {}) };

  const proxyUrl =
    source.HTTPS_PROXY || source.https_proxy || source.HTTP_PROXY || source.http_proxy || undefined;

  // Union both casings instead of letting one shadow the other. The proxy URL
  // and the bypass list are routinely provisioned in different cases - a
  // lowercase `https_proxy` from /etc/profile.d next to an uppercase
  // `NO_PROXY` - and resolving `NO_PROXY || no_proxy` silently discarded the
  // list that paired with the active proxy setting.
  const entries = [source.NO_PROXY, source.no_proxy]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .flatMap((value) => value.split(/[,\s]+/))
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    proxyUrl,
    noProxy: entries.length > 0 ? Array.from(new Set(entries)).join(",") : undefined,
  };
}

export async function getDispatcherWithCertBundle(
  bundlePath: string | undefined,
  insecure: boolean = false,
  allowH2: boolean = false,
  logger?: Logger,
  targetUrl?: string,
  env?: Record<string, string>,
): Promise<UndiciTypesDispatcher> {
  let allCerts: string | undefined;
  if (bundlePath) {
    try {
      const defaultCerts = tls.rootCertificates.join("\n");
      const certs = await fs.readFile(bundlePath, "utf8");
      allCerts = [defaultCerts, certs].join("\n");
    } catch (error) {
      if (logger) {
        logger.error(`Failed to read CA bundle from ${bundlePath}: ${String(error)}`);
      }
      allCerts = tls.rootCertificates.join("\n");
    }
  }

  const { proxyUrl, noProxy } = resolveProxyEnv(env);
  const bypassProxy = shouldBypassProxy(targetUrl, noProxy);

  if (logger) {
    logger.debug("TLS dispatcher config", {
      hasCustomCA: !!bundlePath,
      caBundle: bundlePath || "none",
      insecure,
      allowH2,
      hasProxy: !!proxyUrl,
      proxyUrl: proxyUrl ? sanitizeUrl(proxyUrl) : "none",
      hasNoProxy: !!noProxy,
      targetUrl: targetUrl ? sanitizeUrl(targetUrl) : "none",
      bypassProxy,
    });
  }

  if (proxyUrl && !bypassProxy) {
    if (logger) {
      logger.info(`Using proxy for Hub/provider connections: ${sanitizeUrl(proxyUrl)}`);
    }
    // ProxyAgent ignores `connect` TLS options; target TLS goes through `requestTls`
    // and, for an https:// proxy, the proxy's own TLS through `proxyTls`.
    return new ProxyAgent({
      uri: proxyUrl,
      allowH2,
      requestTls: {
        ca: allCerts,
        rejectUnauthorized: !insecure,
      },
      proxyTls: {
        ca: allCerts,
      },
    }) as unknown as UndiciTypesDispatcher;
  }

  if (proxyUrl && bypassProxy && logger) {
    logger.info(`Bypassing proxy for ${sanitizeUrl(targetUrl!)} (matches NO_PROXY=${noProxy})`);
  }

  return new UndiciAgent({
    connect: {
      ca: allCerts,
      rejectUnauthorized: !insecure,
    },
    allowH2,
  }) as unknown as UndiciTypesDispatcher;
}

export function getFetchWithDispatcher(
  dispatcher: UndiciTypesDispatcher,
): (input: Request | URL | string, init?: RequestInit) => Promise<Response> {
  return (input: Request | URL | string, init?: RequestInit) => {
    return undiciFetch(
      input as any,
      {
        ...(init || {}),
        dispatcher,
      } as any,
    ) as unknown as Promise<Response>;
  };
}

export async function getNodeHttpHandler(
  env: Record<string, string>,
  logger: Logger,
  httpVersion: "1.1" | "2.0" = "1.1",
  targetUrl?: string,
): Promise<NodeHttpHandler | NodeHttp2Handler> {
  const caBundle = env["CA_BUNDLE"] || env["AWS_CA_BUNDLE"];

  let insecure = false;
  if (env["ALLOW_INSECURE"] !== undefined) {
    if (env["ALLOW_INSECURE"].match(/^(true|1)$/i)) {
      insecure = true;
    }
  } else if (env["NODE_TLS_REJECT_UNAUTHORIZED"] === "0") {
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

  const { proxyUrl, noProxy } = resolveProxyEnv(env);
  const bypassProxy = shouldBypassProxy(targetUrl, noProxy);

  interface HttpsAgentOptionsWithALPN extends AgentOptions {
    ALPNProtocols?: string[];
  }

  const agentOptions: HttpsAgentOptionsWithALPN = {
    ca: allCerts,
    rejectUnauthorized: !insecure,
    ALPNProtocols: httpVersion === "2.0" ? ["h2", "http/1.1"] : ["http/1.1"],
  };

  const http1HandlerOptions = {
    requestTimeout: 30000,
    connectionTimeout: 5000,
    socketTimeout: 30000,
  };

  const http2HandlerOptions = {
    requestTimeout: 30000,
    sessionTimeout: 30000,
  };

  if (proxyUrl && bypassProxy) {
    logger.info(`Bypassing proxy for ${sanitizeUrl(targetUrl!)} (matches NO_PROXY=${noProxy})`);
  }

  if (proxyUrl && !bypassProxy) {
    logger.info(`Using proxy ${sanitizeUrl(proxyUrl)} for AWS Bedrock`);

    if (httpVersion === "2.0") {
      logger.warn(
        "HTTP/2 with proxy is not supported via NodeHttp2Handler. " +
          "Falling back to HTTP/1.1 with proxy support.",
      );
      const proxyAgent = new HttpsProxyAgent(proxyUrl, {
        ...agentOptions,
        ALPNProtocols: ["http/1.1"],
      });
      return new NodeHttpHandler({
        ...http1HandlerOptions,
        httpAgent: proxyAgent,
        httpsAgent: proxyAgent,
      });
    }

    const proxyAgent = new HttpsProxyAgent(proxyUrl, agentOptions);
    return new NodeHttpHandler({
      ...http1HandlerOptions,
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent,
    });
  }

  if (httpVersion === "2.0") {
    if (allCerts || insecure) {
      logger.warn(
        "HTTP/2 does not support custom CA bundle or insecure mode via NodeHttp2Handler. " +
          "Falling back to HTTP/1.1.",
      );
      return new NodeHttpHandler({
        ...http1HandlerOptions,
        httpAgent: new HttpsAgent(agentOptions),
        httpsAgent: new HttpsAgent(agentOptions),
      });
    }
    logger.info("Using NodeHttp2Handler for HTTP/2");
    return new NodeHttp2Handler(http2HandlerOptions);
  }

  return new NodeHttpHandler({
    ...http1HandlerOptions,
    httpAgent: new HttpsAgent(agentOptions),
    httpsAgent: new HttpsAgent(agentOptions),
  });
}
