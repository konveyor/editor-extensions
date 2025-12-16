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
  logger?: Logger,
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

  const http1HandlerOptions = {
    requestTimeout: 30000,
    connectionTimeout: 5000,
    socketTimeout: 30000,
  };

  const http2HandlerOptions = {
    requestTimeout: 30000,
    sessionTimeout: 30000,
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
