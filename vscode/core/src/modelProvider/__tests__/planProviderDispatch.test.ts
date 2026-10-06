import expect from "expect";
import winston from "winston";

import { planProviderDispatch, setupProviderTLS } from "../modelCreator";
import { ProxyBypassDispatcher } from "../../utilities/tls";

/**
 * Regression tests for issue #1502.
 *
 * Global routing (the undici global dispatcher and `globalThis.fetch`) is
 * shared with everything else in the extension host. Hub auth and token
 * refresh only use a scoped fetch in insecure mode, so they ride on it.
 * Provider settings must not influence it in either direction:
 *
 *  - pointing the model at a different proxy must not repoint the Hub;
 *  - disabling the model's proxy must not disable the Hub's;
 *  - and the global dispatcher must honor process `NO_PROXY` per destination,
 *    since it serves many hosts and cannot evaluate the list up front.
 *
 * Separately, `needsGlobalDispatcher` has to account for the proxy: undici
 * does not read proxy environment variables on its own, so with HTTP/2 and
 * default TLS the old early return connected directly and dropped it.
 */

const PROXY_ENV_VARS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
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

describe("planProviderDispatch (issue #1502)", () => {
  const base = {
    caBundle: undefined as string | undefined,
    insecure: false,
    allowH2: false,
    processProxyUrl: undefined as string | undefined,
    fromProviderEnv: false,
  };

  describe("needsGlobalDispatcher", () => {
    it("is true for a process proxy with HTTP/2 and default TLS settings", () => {
      // undici does not read proxy env vars itself, so this needs the custom
      // dispatcher - previously it was silently dropped.
      const plan = planProviderDispatch({
        ...base,
        allowH2: true,
        processProxyUrl: "http://corporate-proxy.example.com:8080",
      });

      expect(plan.needsGlobalDispatcher).toBe(true);
    });

    it("stays true when the provider disables its own proxy", () => {
      // The Hub still needs the inherited proxy even though the model does not.
      const plan = planProviderDispatch({
        ...base,
        allowH2: true,
        processProxyUrl: "http://corporate-proxy.example.com:8080",
        fromProviderEnv: true,
      });

      expect(plan.needsGlobalDispatcher).toBe(true);
    });

    it("is false with HTTP/2, default TLS settings and no process proxy", () => {
      expect(planProviderDispatch({ ...base, allowH2: true }).needsGlobalDispatcher).toBe(false);
    });

    it("is not influenced by a provider-only proxy", () => {
      // A YAML-only proxy is the model's business; global routing stays default.
      const plan = planProviderDispatch({ ...base, allowH2: true, fromProviderEnv: true });

      expect(plan.needsGlobalDispatcher).toBe(false);
      expect(plan.scopeToModelClient).toBe(true);
    });

    it("is true for HTTP/1, a CA bundle, or insecure mode", () => {
      expect(planProviderDispatch({ ...base, allowH2: false }).needsGlobalDispatcher).toBe(true);
      expect(
        planProviderDispatch({ ...base, allowH2: true, caBundle: "/etc/ca.pem" })
          .needsGlobalDispatcher,
      ).toBe(true);
      expect(
        planProviderDispatch({ ...base, allowH2: true, insecure: true }).needsGlobalDispatcher,
      ).toBe(true);
    });
  });

  describe("scopeToModelClient", () => {
    it("is true whenever provider settings decided the routing", () => {
      expect(planProviderDispatch({ ...base, fromProviderEnv: true }).scopeToModelClient).toBe(
        true,
      );
    });

    it("is false for process-level routing, so the model shares the global dispatcher", () => {
      expect(
        planProviderDispatch({
          ...base,
          processProxyUrl: "http://corporate-proxy.example.com:8080",
        }).scopeToModelClient,
      ).toBe(false);
    });
  });
});

describe("setupProviderTLS global routing (issue #1502)", () => {
  const logger = winston.createLogger({ silent: true });
  let envSnapshot: Record<string, string | undefined>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    envSnapshot = snapshotProxyEnv();
    originalFetch = globalThis.fetch;
    clearProxyEnv();
  });

  afterEach(() => {
    restoreProxyEnv(envSnapshot);
    globalThis.fetch = originalFetch;
  });

  // `getGlobalDispatcher` is read lazily so the module-level default captured
  // by modelCreator is not disturbed.
  const currentGlobalDispatcher = async (): Promise<any> => {
    const { getGlobalDispatcher } = await import("undici");
    return getGlobalDispatcher();
  };

  it("keeps the inherited proxy for global traffic when the provider disables its own", async () => {
    // David's case 1: HTTP/2, default TLS, inherited proxy, YAML disables it
    // for the model. The Hub must keep the inherited proxy.
    process.env.HTTPS_PROXY = "http://corporate-proxy.example.com:8080";

    const modelFetch = await setupProviderTLS({}, logger, "https://model.internal.example.com/v1", {
      https_proxy: "",
      http_proxy: "",
    });

    const globalDispatcher = await currentGlobalDispatcher();
    expect(globalDispatcher.constructor.name).toBe("ProxyAgent");
    // The model still gets its own, non-proxied fetch.
    expect(modelFetch).toBeDefined();
  });

  it("honors process NO_PROXY per destination on the global dispatcher", async () => {
    // David's case 2: the global dispatcher serves many hosts, so a blanket
    // ProxyAgent ignored NO_PROXY entries such as the Hub's.
    process.env.HTTPS_PROXY = "http://corporate-proxy.example.com:8080";
    process.env.NO_PROXY = "hub.internal,model.internal";

    await setupProviderTLS({}, logger, "https://model.internal/v1", {
      https_proxy: "http://yaml-proxy.example.com:9090",
    });

    const globalDispatcher = await currentGlobalDispatcher();
    expect(globalDispatcher).toBeInstanceOf(ProxyBypassDispatcher);

    const routed = globalDispatcher as ProxyBypassDispatcher;
    expect(routed.dispatcherFor("https://hub.internal").constructor.name).toBe("Agent");
    expect(routed.dispatcherFor("https://api.openai.com").constructor.name).toBe("ProxyAgent");
  });

  it("does not let a provider proxy override reach global routing", async () => {
    process.env.HTTPS_PROXY = "http://corporate-proxy.example.com:8080";

    await setupProviderTLS({}, logger, "https://model.internal/v1", {
      https_proxy: "http://yaml-proxy.example.com:9090",
    });

    const globalDispatcher = await currentGlobalDispatcher();
    // Proxy URLs are not introspectable on ProxyAgent, so assert the shape:
    // global routing came from the process env, which has no NO_PROXY here.
    expect(globalDispatcher.constructor.name).toBe("ProxyAgent");
  });

  it("installs a non-proxying global dispatcher when no proxy is configured", async () => {
    // Default `genai.httpProtocol` is http1, so a custom dispatcher is still
    // required; what matters is that it does not proxy.
    const modelFetch = await setupProviderTLS({}, logger, "https://api.openai.com", undefined);

    const globalDispatcher = await currentGlobalDispatcher();
    expect(globalDispatcher.constructor.name).toBe("Agent");
    // No provider routing of its own, so the model shares global routing.
    expect(modelFetch).toBeDefined();
  });
});
