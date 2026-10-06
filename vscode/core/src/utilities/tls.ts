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

const PROXY_URL_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] as const;
const NO_PROXY_KEYS = ["NO_PROXY", "no_proxy"] as const;

export interface ResolvedProxyConfig {
  proxyUrl?: string;
  noProxy?: string;
  /** True when the provider settings, not the process environment, decided this. */
  fromProviderEnv: boolean;
}

function firstNonEmpty(
  source: Record<string, string | undefined>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value !== "") {
      return value;
    }
  }
  return undefined;
}

function definesAny(
  source: Record<string, string | undefined> | undefined,
  keys: readonly string[],
): boolean {
  return !!source && keys.some((key) => source[key] !== undefined);
}

/**
 * Union the bypass lists across both casings instead of letting one shadow the
 * other. The proxy URL and the bypass list are routinely provisioned in
 * different cases - a lowercase `https_proxy` from /etc/profile.d next to an
 * uppercase `NO_PROXY` - and resolving `NO_PROXY || no_proxy` silently
 * discarded the list that paired with the active proxy setting.
 */
function unionNoProxy(source: Record<string, string | undefined>): string | undefined {
  const entries = NO_PROXY_KEYS.map((key) => source[key])
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .flatMap((value) => value.split(/[,\s]+/))
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries.length > 0 ? Array.from(new Set(entries)).join(",") : undefined;
}

/**
 * Resolve the effective proxy configuration for an outbound connection.
 *
 * `providerEnv` is the `environment:` block from provider-settings.yaml *only*
 * - not merged with the process environment. Provenance matters here: if the
 * provider settings define any proxy key, they win outright, including when
 * the value is an empty string. `https_proxy: ""` is how a user disables the
 * proxy for provider traffic, and falling back to an inherited `HTTPS_PROXY`
 * on a falsy value would silently ignore that. Precedence is also all-or-
 * nothing across casings, so a lowercase YAML override is not shadowed by an
 * uppercase process variable.
 *
 * Callers with no provider context (the Hub) omit it and get the process
 * environment alone.
 */
export function resolveProxyEnv(providerEnv?: Record<string, string>): ResolvedProxyConfig {
  const processEnv = process.env as Record<string, string | undefined>;

  const proxyFromProvider = definesAny(providerEnv, PROXY_URL_KEYS);
  const noProxyFromProvider = definesAny(providerEnv, NO_PROXY_KEYS);

  const proxySource = proxyFromProvider ? providerEnv! : processEnv;
  const noProxySource = noProxyFromProvider ? providerEnv! : processEnv;

  return {
    proxyUrl: firstNonEmpty(proxySource, PROXY_URL_KEYS),
    noProxy: unionNoProxy(noProxySource),
    fromProviderEnv: proxyFromProvider || noProxyFromProvider,
  };
}

export async function getDispatcherWithCertBundle(
  bundlePath: string | undefined,
  insecure: boolean = false,
  allowH2: boolean = false,
  logger?: Logger,
  targetUrl?: string,
  providerEnv?: Record<string, string>,
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

  const { proxyUrl, noProxy } = resolveProxyEnv(providerEnv);
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
  providerEnv?: Record<string, string>,
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

  const { proxyUrl, noProxy } = resolveProxyEnv(providerEnv);
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
