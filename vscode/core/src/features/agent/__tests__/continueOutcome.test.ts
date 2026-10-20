import expect from "expect";
import { decideContinueOutcome, resolveContinueBaseline } from "../continueOutcome";

describe("resolveContinueBaseline", () => {
  it("prefers the queued proposal's original content", () => {
    expect(resolveContinueBaseline({ originalContent: "v1", isNew: false }, "legacy")).toBe("v1");
  });

  it("falls back to modifiedFiles, then to empty for a new file", () => {
    expect(resolveContinueBaseline({ originalContent: undefined, isNew: false }, "legacy")).toBe(
      "legacy",
    );
    expect(resolveContinueBaseline({ originalContent: undefined, isNew: true }, undefined)).toBe(
      "",
    );
  });

  it("returns undefined when no baseline is known", () => {
    expect(resolveContinueBaseline({ originalContent: undefined, isNew: false }, undefined)).toBe(
      undefined,
    );
    expect(resolveContinueBaseline(undefined, undefined)).toBe(undefined);
  });
});

describe("decideContinueOutcome", () => {
  it("rejects the proposal when the file is unchanged from its baseline (#1389 review)", () => {
    // Review → back to chat without resolving the blocks → Continue. The file
    // on disk is still the original, so nothing was accepted.
    expect(decideContinueOutcome("original\n", "original\n", "proposal\n")).toEqual({
      responseId: "reject",
      content: "proposal\n",
    });
  });

  it("applies what the user kept when the file differs from its baseline", () => {
    expect(decideContinueOutcome("partly kept\n", "original\n", "proposal\n")).toEqual({
      responseId: "apply",
      content: "partly kept\n",
    });
  });

  it("ignores line-ending and surrounding whitespace differences", () => {
    expect(decideContinueOutcome("a\r\nb\r\n", "a\nb", "proposal").responseId).toBe("reject");
  });
});
