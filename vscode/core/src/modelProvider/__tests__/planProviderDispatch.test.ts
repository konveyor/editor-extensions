import expect from "expect";

import { planProviderDispatch } from "../modelCreator";

/**
 * Regression tests for issue #1502.
 *
 * Two defects in how a provider connection was dispatched:
 *
 *  1. `needsCustomDispatcher` ignored the resolved proxy. With HTTP/2
 *     selected, no CA bundle and TLS verification on, it was false, so the
 *     early return discarded a proxy that had only been configured in
 *     provider-settings.yaml and the model connected directly.
 *  2. The provider's dispatcher was installed as the global dispatcher and
 *     `globalThis.fetch`. Hub auth and token refresh only use a scoped fetch
 *     in insecure mode, so provider proxy settings silently re-routed
 *     unrelated Hub traffic.
 */
describe("planProviderDispatch (issue #1502)", () => {
  const base = {
    caBundle: undefined as string | undefined,
    insecure: false,
    allowH2: false,
    proxyUrl: undefined as string | undefined,
    fromProviderEnv: false,
  };

  describe("needsCustomDispatcher", () => {
    it("is true for a provider-only proxy with HTTP/2 and default TLS settings", () => {
      const plan = planProviderDispatch({
        ...base,
        allowH2: true,
        proxyUrl: "http://corporate-proxy.example.com:8080",
        fromProviderEnv: true,
      });

      expect(plan.needsCustomDispatcher).toBe(true);
    });

    it("is true for a process-level proxy with HTTP/2 and default TLS settings", () => {
      // undici does not read proxy env vars itself, so this needs the custom
      // dispatcher too - previously it was silently dropped.
      const plan = planProviderDispatch({
        ...base,
        allowH2: true,
        proxyUrl: "http://corporate-proxy.example.com:8080",
      });

      expect(plan.needsCustomDispatcher).toBe(true);
    });

    it("is false with HTTP/2, default TLS settings and no proxy", () => {
      expect(planProviderDispatch({ ...base, allowH2: true }).needsCustomDispatcher).toBe(false);
    });

    it("is true for HTTP/1 regardless of proxy", () => {
      expect(planProviderDispatch({ ...base, allowH2: false }).needsCustomDispatcher).toBe(true);
    });

    it("is true when a CA bundle or insecure mode is configured", () => {
      expect(
        planProviderDispatch({ ...base, allowH2: true, caBundle: "/etc/ca.pem" })
          .needsCustomDispatcher,
      ).toBe(true);
      expect(
        planProviderDispatch({ ...base, allowH2: true, insecure: true }).needsCustomDispatcher,
      ).toBe(true);
    });
  });

  describe("scopeToModelClient", () => {
    it("scopes routing to the model client when provider settings decided it", () => {
      const plan = planProviderDispatch({
        ...base,
        proxyUrl: "http://yaml-proxy.example.com:9090",
        fromProviderEnv: true,
      });

      expect(plan.scopeToModelClient).toBe(true);
    });

    it("leaves the global dispatcher alone for process-level routing", () => {
      // Hub requests share the global dispatcher, so inherited routing must
      // keep applying to them unchanged.
      const plan = planProviderDispatch({
        ...base,
        proxyUrl: "http://corporate-proxy.example.com:8080",
        fromProviderEnv: false,
      });

      expect(plan.scopeToModelClient).toBe(false);
    });

    it("scopes even when the provider disabled the proxy outright", () => {
      // `https_proxy: ""` must not disable the proxy for Hub traffic too.
      const plan = planProviderDispatch({ ...base, proxyUrl: undefined, fromProviderEnv: true });

      expect(plan.scopeToModelClient).toBe(true);
    });
  });
});
