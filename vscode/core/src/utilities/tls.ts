import tls from "node:tls";
import fs from "fs/promises";
import { Agent as HttpsAgent } from "node:https";
import { Agent as UndiciAgent, ProxyAgent } from "undici";
import type { Dispatcher as UndiciTypesDispatcher } from "undici-types";

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
  let allCerts: string[] | undefined;
  if (bundlePath) {
    // Load custom certificate and combine with Node.js defaults as an array
    // undici expects an array of certificate strings, not a concatenated string
    const customCert = await fs.readFile(bundlePath, "utf8");
    allCerts = [...tls.rootCertificates, customCert];
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
  let allCerts: string[] | undefined;
  if (bundlePath) {
    // Load custom certificate and combine with Node.js defaults as an array
    const customCert = await fs.readFile(bundlePath, "utf8");
    allCerts = [...tls.rootCertificates, customCert];
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
