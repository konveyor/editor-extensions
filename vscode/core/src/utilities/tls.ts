import tls from "node:tls";
import fs from "fs/promises";
import { Agent as HttpsAgent } from "node:https";
import { Agent as UndiciAgent } from "undici";
import type { Dispatcher as UndiciTypesDispatcher } from "undici-types";

export async function getDispatcherWithCertBundle(
  bundlePath: string | undefined,
  insecure: boolean = false,
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
