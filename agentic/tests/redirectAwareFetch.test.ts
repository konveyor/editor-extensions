import { createRedirectAwareFetch } from "../src/clients/solutionServerClient";

// Mock fetch globally for tests
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("createRedirectAwareFetch", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("should pass through non-redirect responses", async () => {
    const originalUrl = new URL("https://hub.example.com/hub/services/kai/api");
    const redirectAwareFetch = createRedirectAwareFetch(originalUrl);

    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
    });

    const response = await redirectAwareFetch("https://hub.example.com/hub/services/kai/api", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hub.example.com/hub/services/kai/api",
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
      }),
    );
  });

  it("should rewrite internal K8s service URLs to external URLs", async () => {
    const originalUrl = new URL("https://hub.example.com/hub/services/kai/api");
    const redirectAwareFetch = createRedirectAwareFetch(originalUrl);

    // First call returns a redirect to internal K8s URL
    mockFetch.mockResolvedValueOnce({
      status: 307,
      headers: new Headers({
        location: "http://tackle-hub.konveyor-tackle.svc:8080/api/messages",
      }),
    });

    // Second call (after rewrite) succeeds
    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
    });

    const response = await redirectAwareFetch("https://hub.example.com/hub/services/kai/api", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Second call should use rewritten URL with original host and path prefix
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://hub.example.com/hub/services/kai/api/messages",
      expect.objectContaining({
        redirect: "manual",
      }),
    );
  });

  it("should preserve query parameters when rewriting URLs", async () => {
    const originalUrl = new URL("https://hub.example.com/hub/services/kai/api");
    const redirectAwareFetch = createRedirectAwareFetch(originalUrl);

    mockFetch.mockResolvedValueOnce({
      status: 307,
      headers: new Headers({
        location: "http://tackle-hub.svc/api/data?foo=bar&baz=123",
      }),
    });

    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
    });

    await redirectAwareFetch("https://hub.example.com/hub/services/kai/api");

    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://hub.example.com/hub/services/kai/api/data?foo=bar&baz=123",
      expect.objectContaining({
        redirect: "manual",
      }),
    );
  });

  it("should not rewrite URLs from the same host", async () => {
    const originalUrl = new URL("https://hub.example.com/hub/services/kai/api");
    const redirectAwareFetch = createRedirectAwareFetch(originalUrl);

    // Redirect to same host, different path
    mockFetch.mockResolvedValueOnce({
      status: 307,
      headers: new Headers({
        location: "https://hub.example.com/hub/services/kai/api/v2",
      }),
    });

    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
    });

    await redirectAwareFetch("https://hub.example.com/hub/services/kai/api");

    // Should follow redirect without path prefix modification since same host
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://hub.example.com/hub/services/kai/api/v2",
      expect.objectContaining({
        redirect: "manual",
      }),
    );
  });

  it("should throw error after max redirects", async () => {
    const originalUrl = new URL("https://hub.example.com/hub/services/kai/api");
    const redirectAwareFetch = createRedirectAwareFetch(originalUrl);

    // Return redirect response 11 times (more than max of 10)
    for (let i = 0; i < 11; i++) {
      mockFetch.mockResolvedValueOnce({
        status: 307,
        headers: new Headers({
          location: `http://internal.svc/api/path${i}`,
        }),
      });
    }

    await expect(
      redirectAwareFetch("https://hub.example.com/hub/services/kai/api"),
    ).rejects.toThrow("Maximum redirect limit reached");
  });

  it("should return response when redirect has no location header", async () => {
    const originalUrl = new URL("https://hub.example.com/hub/services/kai/api");
    const redirectAwareFetch = createRedirectAwareFetch(originalUrl);

    mockFetch.mockResolvedValueOnce({
      status: 307,
      headers: new Headers(), // No location header
    });

    const response = await redirectAwareFetch("https://hub.example.com/hub/services/kai/api");

    expect(response.status).toBe(307);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should use logger when provided", async () => {
    const originalUrl = new URL("https://hub.example.com/hub/services/kai/api");
    const mockLogger = { debug: jest.fn() };
    const redirectAwareFetch = createRedirectAwareFetch(originalUrl, mockLogger);

    mockFetch.mockResolvedValueOnce({
      status: 307,
      headers: new Headers({
        location: "http://tackle-hub.svc/api/data",
      }),
    });

    mockFetch.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
    });

    await redirectAwareFetch("https://hub.example.com/hub/services/kai/api");

    expect(mockLogger.debug).toHaveBeenCalled();
  });
});
