import expect from "expect";

import {
  classifyNetworkError,
  describeErrorChain,
  NetworkErrorCategory,
} from "../networkDiagnostics";

/**
 * Regression tests for issue #1503:
 *
 * A model provider that cannot be reached surfaced as a bare
 * `Error: Connection error.` with `cause: {}` in the logs - openai-node
 * collapses every transport failure into that message, and Winston
 * serializes a nested `Error` to an empty object. The root cause code
 * (`UND_ERR_HEADERS_TIMEOUT`, `ECONNREFUSED`, ...) was therefore lost.
 */
describe("describeErrorChain", () => {
  it("renders a single error", () => {
    expect(describeErrorChain(new Error("boom"))).toBe("Error: boom");
  });

  it("includes the error code when present", () => {
    const err = Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });
    expect(describeErrorChain(err)).toBe("Error: connect failed [ECONNREFUSED]");
  });

  it("walks the cause chain so the root cause survives logging", () => {
    const root = Object.assign(new Error("Headers Timeout Error"), {
      code: "UND_ERR_HEADERS_TIMEOUT",
    });
    const middle = new Error("fetch failed", { cause: root });
    const top = new Error("Connection error.", { cause: middle });

    expect(describeErrorChain(top)).toBe(
      "Error: Connection error. <- caused by: Error: fetch failed <- caused by: " +
        "Error: Headers Timeout Error [UND_ERR_HEADERS_TIMEOUT]",
    );
  });

  it("does not loop forever on a cyclic cause chain", () => {
    const a: any = new Error("a");
    const b: any = new Error("b", { cause: a });
    a.cause = b;

    expect(describeErrorChain(a)).toBe("Error: a <- caused by: Error: b");
  });

  it("handles non-Error values", () => {
    expect(describeErrorChain("plain string")).toBe("plain string");
    expect(describeErrorChain(undefined)).toBe("Unknown error");
  });
});

describe("classifyNetworkError on wrapped SDK errors", () => {
  it("classifies an undici headers timeout buried under an SDK wrapper as a timeout", () => {
    const root = Object.assign(new Error("Headers Timeout Error"), {
      code: "UND_ERR_HEADERS_TIMEOUT",
    });
    const top = new Error("Connection error.", {
      cause: new Error("fetch failed", { cause: root }),
    });

    const classified = classifyNetworkError(top);
    expect(classified.category).toBe(NetworkErrorCategory.TIMEOUT);
    expect(classified.suggestion).toMatch(/proxy settings/);
  });

  it("classifies a refused connection buried under an SDK wrapper", () => {
    const root = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const top = new Error("Connection error.", { cause: root });

    expect(classifyNetworkError(top).category).toBe(NetworkErrorCategory.CONNECTION);
  });

  it("falls back to UNKNOWN when there is no recognizable cause", () => {
    expect(classifyNetworkError(new Error("Connection error.")).category).toBe(
      NetworkErrorCategory.UNKNOWN,
    );
  });
});
