import tls from "node:tls";
import fs from "fs/promises";
import { Agent as HttpsAgent, type AgentOptions } from "node:https";
import { Agent as UndiciAgent, ProxyAgent } from "undici";
import type { Dispatcher as UndiciTypesDispatcher } from "undici-types";
import { NodeHttpHandler, NodeHttp2Handler } from "@smithy/node-http-handler";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { Logger } from "winston";

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

  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  if (proxyUrl) {
    return new ProxyAgent({
      uri: proxyUrl,
      allowH2,
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

  const proxyUrl =
    env["HTTPS_PROXY"] ||
    env["https_proxy"] ||
    env["HTTP_PROXY"] ||
    env["http_proxy"] ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;

  interface HttpsAgentOptionsWithALPN extends AgentOptions {
    ALPNProtocols?: string[];
  }

  const agentOptions: HttpsAgentOptionsWithALPN = {
    ca: allCerts,
    rejectUnauthorized: !insecure,
    ALPNProtocols: httpVersion === "2.0" ? ["h2", "http/1.1"] : ["http/1.1"],
  };

  const handlerOptions = {
    requestTimeout: 30000,
    connectionTimeout: 5000,
    socketTimeout: 30000,
  };

  if (proxyUrl) {
    logger.info(`Using proxy ${proxyUrl} for AWS Bedrock`);

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
