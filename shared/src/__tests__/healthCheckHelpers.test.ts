import { expect } from "expect";
import {
  CheckResultBuilder,
  withErrorHandling,
  skipIfNotPlatform,
  formatError,
  formatDetails,
} from "../healthCheckHelpers";

describe("healthCheckHelpers", () => {
  describe("CheckResultBuilder", () => {
    const builder = new CheckResultBuilder("My Check");

    it("should build a pass result", () => {
      expect(builder.pass("All good", "some details")).toEqual({
        name: "My Check",
        status: "pass",
        message: "All good",
        details: "some details",
      });
    });

    it("should build a fail result with details and a suggestion", () => {
      expect(builder.fail("Broken", "why", "fix it")).toEqual({
        name: "My Check",
        status: "fail",
        message: "Broken",
        details: "why",
        suggestion: "fix it",
      });
    });

    it("should build a warning result", () => {
      expect(builder.warning("Careful", "why", "check it")).toEqual({
        name: "My Check",
        status: "warning",
        message: "Careful",
        details: "why",
        suggestion: "check it",
      });
    });

    it("should build a skip result", () => {
      expect(builder.skip("Not needed")).toEqual({
        name: "My Check",
        status: "skip",
        message: "Not needed",
      });
    });

    it("should omit details and suggestion when they are not provided", () => {
      const results = [builder.pass("ok"), builder.fail("bad"), builder.warning("hmm", "", "")];
      for (const result of results) {
        expect(result).not.toHaveProperty("details");
        expect(result).not.toHaveProperty("suggestion");
      }
    });
  });

  describe("withErrorHandling()", () => {
    it("should return the result of the check", async () => {
      const logger = { error: () => undefined };
      const expected = new CheckResultBuilder("My Check").pass("ok");

      expect(await withErrorHandling("My Check", logger, async () => expected)).toBe(expected);
    });

    it("should return a fail result and log when the check throws", async () => {
      const logged: unknown[][] = [];
      const logger = { error: (...args: unknown[]) => logged.push(args) };
      const error = new Error("boom");

      const result = await withErrorHandling("My Check", logger, async () => {
        throw error;
      });

      expect(result).toEqual({
        name: "My Check",
        status: "fail",
        message: "Failed to check My Check",
        details: "boom",
      });
      expect(logged).toEqual([["Error during health check: My Check", error]]);
    });
  });

  describe("skipIfNotPlatform()", () => {
    it("should return null when the platform matches", () => {
      expect(skipIfNotPlatform("My Check", "win32", "win32")).toBeNull();
    });

    it("should return a skip result when the platform does not match", () => {
      expect(skipIfNotPlatform("My Check", "win32", "linux")).toEqual({
        name: "My Check",
        status: "skip",
        message: "Not applicable on linux platform",
      });
    });
  });

  describe("formatError()", () => {
    it("should return the message of an Error", () => {
      expect(formatError(new Error("boom"))).toBe("boom");
    });

    it("should convert other values to a string", () => {
      expect(formatError("plain")).toBe("plain");
      expect(formatError(42)).toBe("42");
    });
  });

  describe("formatDetails()", () => {
    it("should join lines with newlines", () => {
      expect(formatDetails("a", "b", "c")).toBe("a\nb\nc");
    });

    it("should skip undefined and empty lines", () => {
      expect(formatDetails("a", undefined, "", "b")).toBe("a\nb");
    });
  });
});
