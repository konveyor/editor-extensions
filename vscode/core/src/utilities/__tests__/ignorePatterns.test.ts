import expect from "expect";
import { ignorePatternToGlob, parseIgnoreFileToGlobPatterns } from "../ignorePatterns";

/**
 * This test file verifies the behavior of ignore file pattern processing
 * for the ignoresToExcludedPaths function.
 *
 * Supports .gitignore, .konveyorignore, and similar ignore file formats.
 *
 * Issue #1182: When analyzing a project with `dist/` in .gitignore,
 * the extension should ignore ALL dist directories at any level,
 * not just the top-level one.
 */

describe("ignorePatternToGlob", () => {
  it("should add **/ prefix to patterns without leading / or **", () => {
    expect(ignorePatternToGlob("dist/")).toBe("**/dist/");
    expect(ignorePatternToGlob("node_modules/")).toBe("**/node_modules/");
    expect(ignorePatternToGlob("build")).toBe("**/build");
    expect(ignorePatternToGlob(".cache/")).toBe("**/.cache/");
  });

  it("should preserve patterns that already start with **", () => {
    expect(ignorePatternToGlob("**/dist/")).toBe("**/dist/");
    expect(ignorePatternToGlob("**/*.log")).toBe("**/*.log");
  });

  it("should preserve patterns that start with /", () => {
    // Leading / in ignore files means "top-level only"
    expect(ignorePatternToGlob("/dist/")).toBe("/dist/");
    expect(ignorePatternToGlob("/build")).toBe("/build");
  });

  it("should handle patterns with wildcards", () => {
    expect(ignorePatternToGlob("*.log")).toBe("**/*.log");
    expect(ignorePatternToGlob("*.tmp")).toBe("**/*.tmp");
  });
});

describe("parseIgnoreFileToGlobPatterns", () => {
  it("should parse simple patterns and convert to glob format", () => {
    const content = "dist/\nnode_modules/\nbuild/";
    const result = parseIgnoreFileToGlobPatterns(content);

    expect(result).toEqual(["**/dist/", "**/node_modules/", "**/build/"]);
  });

  it("should filter out empty lines", () => {
    const content = "dist/\n\nnode_modules/\n\n";
    const result = parseIgnoreFileToGlobPatterns(content);

    expect(result).toEqual(["**/dist/", "**/node_modules/"]);
  });

  it("should filter out comment lines", () => {
    const content = "# This is a comment\ndist/\n# Another comment\nnode_modules/";
    const result = parseIgnoreFileToGlobPatterns(content);

    expect(result).toEqual(["**/dist/", "**/node_modules/"]);
  });

  it("should handle Windows-style line endings", () => {
    const content = "dist/\r\nnode_modules/\r\nbuild/";
    const result = parseIgnoreFileToGlobPatterns(content);

    expect(result).toEqual(["**/dist/", "**/node_modules/", "**/build/"]);
  });

  it("should preserve patterns with leading /", () => {
    const content = "/dist/\nnode_modules/";
    const result = parseIgnoreFileToGlobPatterns(content);

    // /dist/ stays as-is (top-level only), node_modules/ gets **/ prefix
    expect(result).toEqual(["/dist/", "**/node_modules/"]);
  });

  it("should preserve patterns with leading **", () => {
    const content = "**/dist/\n**/node_modules/";
    const result = parseIgnoreFileToGlobPatterns(content);

    expect(result).toEqual(["**/dist/", "**/node_modules/"]);
  });

  it("should handle base path joining", () => {
    const content = "dist/";
    // When ignore file is in a subdirectory, base would be that subdirectory
    const result = parseIgnoreFileToGlobPatterns(content, "subdir");

    // Pattern is relative to ignore file location: subdir/dist/
    // Then gets **/ prefix since it doesn't start with / or **
    expect(result).toEqual(["**/subdir/dist/"]);
  });

  it("should handle empty content", () => {
    const result = parseIgnoreFileToGlobPatterns("");
    expect(result).toEqual([]);
  });

  it("should handle content with only comments", () => {
    const content = "# Comment 1\n# Comment 2";
    const result = parseIgnoreFileToGlobPatterns(content);
    expect(result).toEqual([]);
  });

  it("should handle realistic ignore file content", () => {
    const content = `# Build outputs
dist/
build/
out/

# Dependencies
node_modules/

# IDE
.idea/
.vscode/

# Logs
*.log
`;
    const result = parseIgnoreFileToGlobPatterns(content);

    expect(result).toEqual([
      "**/dist/",
      "**/build/",
      "**/out/",
      "**/node_modules/",
      "**/.idea/",
      "**/.vscode/",
      "**/*.log",
    ]);
  });
});
