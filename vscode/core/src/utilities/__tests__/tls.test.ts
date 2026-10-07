import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as os from "os";
import * as pathlib from "path";
import { execFile } from "child_process";
import type { AddressInfo } from "net";
import expect from "expect";
import winston from "winston";

import {
  getDispatcherWithCertBundle,
  getFetchWithDispatcher,
  getNodeHttpHandler,
  shouldBypassProxy,
} from "../tls";

/**
 * Regression tests for issue #1415:
 *
 * When `HTTP_PROXY` / `HTTPS_PROXY` are set in the environment and `NO_PROXY`
 * lists the target host (e.g. `127.0.0.1`), the extension was still routing
 * the connection through the proxy because `tls.ts` did not consult
 * `NO_PROXY`.
 *
 * These tests pin the desired behavior at two layers:
 *   1. `shouldBypassProxy(targetUrl, noProxy)` — pure helper, covers NO_PROXY
 *      matching semantics.
 *   2. `getDispatcherWithCertBundle` / `getNodeHttpHandler` — must bypass the
 *      proxy-agent path when the target URL matches NO_PROXY.
 */

const PROXY_ENV_VARS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
];

function snapshotProxyEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of PROXY_ENV_VARS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreProxyEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of PROXY_ENV_VARS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function clearProxyEnv(): void {
  for (const key of PROXY_ENV_VARS) {
    delete process.env[key];
  }
}

describe("tls — NO_PROXY handling (issue #1415)", () => {
  describe("shouldBypassProxy", () => {
    it("returns false when noProxy is undefined", () => {
      expect(shouldBypassProxy("https://example.com", undefined)).toBe(false);
    });

    it("returns false when noProxy is empty string", () => {
      expect(shouldBypassProxy("https://example.com", "")).toBe(false);
    });

    it("returns false when targetUrl is undefined", () => {
      expect(shouldBypassProxy(undefined, "*")).toBe(false);
    });

    it("returns true when noProxy is wildcard '*'", () => {
      expect(shouldBypassProxy("https://anything.example.com/path", "*")).toBe(true);
      expect(shouldBypassProxy("http://127.0.0.1:8080", "*")).toBe(true);
    });

    it("returns true for exact IP match (bug #1415 repro)", () => {
      expect(shouldBypassProxy("http://127.0.0.1:8080/v1", "127.0.0.1")).toBe(true);
    });

    it("returns true for exact hostname match", () => {
      expect(shouldBypassProxy("http://localhost:8080", "localhost")).toBe(true);
    });

    it("matches an entry in a comma-separated list", () => {
      expect(shouldBypassProxy("http://foo.example.com", "a.com,foo.example.com,bar.com")).toBe(
        true,
      );
    });

    it("tolerates whitespace around comma-separated entries", () => {
      expect(shouldBypassProxy("http://localhost", "  localhost , 127.0.0.1  ")).toBe(true);
    });

    it("treats leading-dot entries as domain suffix matches for subdomains", () => {
      expect(shouldBypassProxy("https://api.example.com", ".example.com")).toBe(true);
    });

    it("does not match the parent domain when entry has a leading dot", () => {
      expect(shouldBypassProxy("https://example.com", ".example.com")).toBe(false);
    });

    it("treats bare-host entries as suffix matches (curl/requests style)", () => {
      expect(shouldBypassProxy("https://api.example.com", "example.com")).toBe(true);
    });

    it("does not falsely match unrelated hosts", () => {
      expect(shouldBypassProxy("https://api.openai.com", "127.0.0.1,localhost")).toBe(false);
    });

    it("is case-insensitive on host comparison", () => {
      expect(shouldBypassProxy("https://API.Example.COM", "example.com")).toBe(true);
    });

    it("honors port-qualified entries", () => {
      expect(shouldBypassProxy("http://localhost:8080", "localhost:8080")).toBe(true);
    });

    it("does not match when the port-qualified entry's port differs", () => {
      expect(shouldBypassProxy("http://localhost:9090", "localhost:8080")).toBe(false);
    });

    it("returns false (no throw) when targetUrl is not a parseable URL", () => {
      expect(shouldBypassProxy("not a url", "*")).toBe(false);
      expect(shouldBypassProxy("", "*")).toBe(false);
    });

    it("does not confuse partial-string overlaps (e.g. 'example.com' must not match 'badexample.com')", () => {
      expect(shouldBypassProxy("https://badexample.com", "example.com")).toBe(false);
    });
  });

  describe("getDispatcherWithCertBundle", () => {
    const logger = winston.createLogger({ silent: true });
    let envSnapshot: Record<string, string | undefined>;

    beforeEach(() => {
      envSnapshot = snapshotProxyEnv();
      clearProxyEnv();
    });

    afterEach(() => {
      restoreProxyEnv(envSnapshot);
    });

    it("returns a non-ProxyAgent dispatcher when NO_PROXY matches the target host (bug #1415)", async () => {
      process.env.HTTPS_PROXY = "http://corporate-proxy.example.com:8080";
      process.env.NO_PROXY = "127.0.0.1";

      const dispatcher = await getDispatcherWithCertBundle(
        undefined,
        false,
        false,
        logger,
        "http://127.0.0.1:8080/v1",
      );

      expect(dispatcher.constructor.name).not.toBe("ProxyAgent");
    });

    it("still returns a ProxyAgent when HTTPS_PROXY is set and NO_PROXY is unset", async () => {
      process.env.HTTPS_PROXY = "http://corporate-proxy.example.com:8080";

      const dispatcher = await getDispatcherWithCertBundle(
        undefined,
        false,
        false,
        logger,
        "https://api.openai.com",
      );

      expect(dispatcher.constructor.name).toBe("ProxyAgent");
    });

    it("still uses the proxy when NO_PROXY exists but does not match the target host", async () => {
      process.env.HTTPS_PROXY = "http://corporate-proxy.example.com:8080";
      process.env.NO_PROXY = "api.openai.com";

      const dispatcher = await getDispatcherWithCertBundle(
        undefined,
        false,
        false,
        logger,
        "https://other.example.com",
      );

      expect(dispatcher.constructor.name).toBe("ProxyAgent");
    });

    it("returns a plain Agent when no proxy env vars are set, regardless of targetUrl", async () => {
      const dispatcher = await getDispatcherWithCertBundle(
        undefined,
        false,
        false,
        logger,
        "http://127.0.0.1:8080",
      );

      expect(dispatcher.constructor.name).not.toBe("ProxyAgent");
    });

    it("preserves back-compat: callers that omit targetUrl still get a ProxyAgent when proxy env vars are set", async () => {
      process.env.HTTPS_PROXY = "http://corporate-proxy.example.com:8080";

      const dispatcher = await getDispatcherWithCertBundle(undefined, false, false, logger);

      expect(dispatcher.constructor.name).toBe("ProxyAgent");
    });
  });

  describe("getNodeHttpHandler", () => {
    const logger = winston.createLogger({ silent: true });
    let envSnapshot: Record<string, string | undefined>;

    beforeEach(() => {
      envSnapshot = snapshotProxyEnv();
      clearProxyEnv();
    });

    afterEach(() => {
      restoreProxyEnv(envSnapshot);
    });

    it("does not wrap requests in an HttpsProxyAgent when NO_PROXY matches the target host (bug #1415)", async () => {
      const env = {
        HTTPS_PROXY: "http://corporate-proxy.example.com:8080",
        NO_PROXY: "127.0.0.1",
      };

      const handler = await getNodeHttpHandler(env, logger, "1.1", "http://127.0.0.1:8080");
      const config = await (handler as any).configProvider;

      expect(config.httpsAgent.constructor.name).not.toBe("HttpsProxyAgent");
    });

    it("still wraps in HttpsProxyAgent when NO_PROXY does not match the target host", async () => {
      const env = {
        HTTPS_PROXY: "http://corporate-proxy.example.com:8080",
        NO_PROXY: "127.0.0.1",
      };

      const handler = await getNodeHttpHandler(
        env,
        logger,
        "1.1",
        "https://bedrock-runtime.us-east-1.amazonaws.com",
      );
      const config = await (handler as any).configProvider;

      expect(config.httpsAgent.constructor.name).toBe("HttpsProxyAgent");
    });
  });
});

// Regression tests for #1043: CA_BUNDLE and ALLOW_INSECURE were ignored behind a proxy.
(process.platform === "win32" ? describe.skip : describe)(
  "tls — custom CA through an HTTP proxy (issue #1043)",
  () => {
    const logger = winston.createLogger({ silent: true });
    const scriptsDir = pathlib.join(__dirname, "..", "..", "modelProvider", "__tests__", "scripts");
    let certsDir: string;
    let target: https.Server;
    let proxy: http.Server;
    let tlsProxy: https.Server;
    let targetUrl: string;
    let tunnels: string[];
    let envSnapshot: Record<string, string | undefined>;

    before(async function (this: Mocha.Context) {
      this.timeout(15000);
      // Created here rather than at definition time: a skipped suite still runs its
      // describe callback, but never its hooks, so it would leak the directory.
      certsDir = fs.mkdtempSync(pathlib.join(os.tmpdir(), "tls-proxy-test-"));
      await new Promise<void>((resolve, reject) => {
        execFile("bash", ["genCerts.sh", certsDir], { cwd: scriptsDir }, (err) =>
          err ? reject(err) : resolve(),
        );
      });

      target = https.createServer(
        {
          key: fs.readFileSync(pathlib.join(certsDir, "srv.key")),
          cert: fs.readFileSync(pathlib.join(certsDir, "srv.crt")),
        },
        (_req, res) => res.end("ok"),
      );
      await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
      targetUrl = `https://localhost:${(target.address() as AddressInfo).port}/`;

      const onConnect = (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
        tunnels.push(req.url ?? "");
        const [host, port] = (req.url ?? "").split(":");
        const upstream = net.connect(Number(port), host, () => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          upstream.write(head);
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        });
        upstream.on("error", () => clientSocket.destroy());
        clientSocket.on("error", () => upstream.destroy());
      };
      proxy = http.createServer();
      proxy.on("connect", onConnect);
      await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));

      // An https:// proxy, signed by the same test CA as the target.
      tlsProxy = https.createServer({
        key: fs.readFileSync(pathlib.join(certsDir, "srv.key")),
        cert: fs.readFileSync(pathlib.join(certsDir, "srv.crt")),
      });
      tlsProxy.on("connect", onConnect);
      await new Promise<void>((resolve) => tlsProxy.listen(0, "127.0.0.1", resolve));
    });

    beforeEach(() => {
      tunnels = [];
      envSnapshot = snapshotProxyEnv();
      clearProxyEnv();
      process.env.HTTPS_PROXY = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    });

    afterEach(() => {
      restoreProxyEnv(envSnapshot);
    });

    after(async () => {
      for (const server of [target, proxy, tlsProxy]) {
        if (server?.listening) {
          server.closeAllConnections();
          await new Promise((r) => server.close(r));
        }
      }
      if (certsDir) {
        fs.rmSync(certsDir, { recursive: true, force: true });
      }
    });

    async function fetchThroughProxy(bundlePath: string | undefined, insecure: boolean) {
      const dispatcher = await getDispatcherWithCertBundle(
        bundlePath,
        insecure,
        false,
        logger,
        targetUrl,
      );
      try {
        const res = await getFetchWithDispatcher(dispatcher)(targetUrl);
        return await res.text();
      } finally {
        await dispatcher.close();
      }
    }

    it("trusts CA_BUNDLE for the target when tunnelling through the proxy", async () => {
      expect(await fetchThroughProxy(pathlib.join(certsDir, "ca.crt"), false)).toBe("ok");
      expect(tunnels).toHaveLength(1);
    });

    it("honors ALLOW_INSECURE for the target when tunnelling through the proxy", async () => {
      expect(await fetchThroughProxy(undefined, true)).toBe("ok");
      expect(tunnels).toHaveLength(1);
    });

    it("still rejects an untrusted target certificate through the proxy", async () => {
      await expect(fetchThroughProxy(undefined, false)).rejects.toThrow("fetch failed");
      expect(tunnels).toHaveLength(1);
    });

    it("trusts CA_BUNDLE for an https:// proxy as well as the target", async () => {
      process.env.HTTPS_PROXY = `https://localhost:${(tlsProxy.address() as AddressInfo).port}`;
      expect(await fetchThroughProxy(pathlib.join(certsDir, "ca.crt"), false)).toBe("ok");
      expect(tunnels).toHaveLength(1);
    });

    it("does not let ALLOW_INSECURE skip verifying an https:// proxy", async () => {
      process.env.HTTPS_PROXY = `https://localhost:${(tlsProxy.address() as AddressInfo).port}`;
      await expect(fetchThroughProxy(undefined, true)).rejects.toThrow("fetch failed");
      expect(tunnels).toHaveLength(0);
    });
  },
);
