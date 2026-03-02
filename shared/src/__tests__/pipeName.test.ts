import { expect } from "expect";
import { generateSafePipeName } from "../pipeName";

describe("generateSafePipeName", () => {
  it("should return unique paths on each call", () => {
    const paths = new Set<string>();
    for (let i = 0; i < 100; i++) {
      paths.add(generateSafePipeName());
    }
    expect(paths.size).toBe(100);
  });

  it("should return a path under the macOS 103 char limit", () => {
    const pipeName = generateSafePipeName();
    expect(pipeName.length).toBeLessThanOrEqual(103);
  });

  if (process.platform !== "win32") {
    it("should start with /tmp/ on Unix", () => {
      const pipeName = generateSafePipeName();
      expect(pipeName).toMatch(/^\/tmp\//);
    });

    it("should end with .sock", () => {
      const pipeName = generateSafePipeName();
      expect(pipeName).toMatch(/\.sock$/);
    });

    it("should use the konveyor prefix", () => {
      const pipeName = generateSafePipeName();
      expect(pipeName).toMatch(/^\/tmp\/konveyor-/);
    });
  }
});
