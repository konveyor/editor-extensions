import tls from "node:tls";
import fs from "fs/promises";
import { Agent as HttpsAgent } from "node:https";
import { Agent as UndiciAgent } from "undici";
import type { Dispatcher as UndiciTypesDispatcher } from "undici-types";
import { NodeHttpHandler } from "@smithy/node-http-handler";
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
): Promise<NodeHttpHandler> {
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

  const agentOptions: any = {
    ca: allCerts,
    rejectUnauthorized: !insecure,
    // Configure HTTP version using ALPN
    ...(httpVersion === "1.1"
      ? {
          ALPNProtocols: ["http/1.1"],
        }
      : {
          ALPNProtocols: ["h2", "http/1.1"], // Allow HTTP/2 with fallback
        }),
  };

  return new NodeHttpHandler({
    httpsAgent: new HttpsAgent(agentOptions),
    requestTimeout: 30000,
  });
}
