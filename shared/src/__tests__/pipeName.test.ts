import { expect } from "expect";
import { generateSafePipeName } from "../pipeName";

const TEST_PREFIX = "test-ext";

describe("generateSafePipeName", () => {
  it("should return unique paths on each call", () => {
    const paths = new Set<string>();
    for (let i = 0; i < 100; i++) {
      paths.add(generateSafePipeName(TEST_PREFIX));
    }
    expect(paths.size).toBe(100);
  });

  it("should return a path under the macOS 103 char limit", () => {
    const pipeName = generateSafePipeName(TEST_PREFIX);
    expect(pipeName.length).toBeLessThanOrEqual(103);
  });

  it("should incorporate the prefix", () => {
    const pipeName = generateSafePipeName("my-extension");
    expect(pipeName).toContain("my-extension-");
  });

  if (process.platform === "win32") {
    it("should use named pipe format on Windows", () => {
      const pipeName = generateSafePipeName(TEST_PREFIX);
      expect(pipeName).toMatch(/^\\\\\.\\pipe\\/);
    });
  } else {
    it("should start with /tmp/ on Unix", () => {
      const pipeName = generateSafePipeName(TEST_PREFIX);
      expect(pipeName).toMatch(/^\/tmp\//);
    });

    it("should end with .sock", () => {
      const pipeName = generateSafePipeName(TEST_PREFIX);
      expect(pipeName).toMatch(/\.sock$/);
    });
  }
});
