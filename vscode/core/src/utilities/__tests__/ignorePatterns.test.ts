import expect from "expect";
import ignore from "ignore";
import {
  createIgnoreFromWorkspace,
  filterIgnoredPaths,
  isPathIgnored,
  getIgnorePatternsForGlob,
  IGNORE_FILE_PRIORITY,
  DEFAULT_IGNORE_PATTERNS,
  ALWAYS_IGNORE_PATTERNS,
} from "../ignorePatterns";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { globbySync } from "globby";

/**
 * This test file verifies the behavior of ignore file processing
 * using the `ignore` npm package which properly implements gitignore semantics.
 *
 * Supports .gitignore, .konveyorignore, and similar ignore file formats.
 *
 * Issue #1182: When analyzing a project with `dist/` in .gitignore,
 * the extension should ignore ALL dist directories at any level,
 * not just the top-level one.
 */

describe("ignorePatterns module", () => {
  describe("constants", () => {
    it("should have correct priority order for ignore files", () => {
      expect(IGNORE_FILE_PRIORITY).toEqual([".konveyorignore", ".gitignore"]);
    });

    it("should have sensible default patterns", () => {
      expect(DEFAULT_IGNORE_PATTERNS).toContain(".git");
      expect(DEFAULT_IGNORE_PATTERNS).toContain("node_modules");
    });

    it("should always ignore .konveyor directory", () => {
      expect(ALWAYS_IGNORE_PATTERNS).toContain(".konveyor");
    });
  });

  describe("createIgnoreFromWorkspace", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = mkdtempSync(join(tmpdir(), "konveyor-test-"));
    });

    afterEach(() => {
      if (testDir) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("should load .konveyorignore when present", () => {
      writeFileSync(join(testDir, ".konveyorignore"), "custom-ignore/\n");
      writeFileSync(join(testDir, ".gitignore"), "git-ignore/\n");

      const { ig, ignoreFile } = createIgnoreFromWorkspace(testDir);

      expect(ignoreFile).toBe(join(testDir, ".konveyorignore"));
      expect(ig.ignores("custom-ignore/")).toBe(true);
      // .gitignore should NOT be loaded when .konveyorignore exists
      expect(ig.ignores("git-ignore/")).toBe(false);
    });

    it("should fall back to .gitignore when .konveyorignore is not present", () => {
      writeFileSync(join(testDir, ".gitignore"), "git-ignore/\n");

      const { ig, ignoreFile } = createIgnoreFromWorkspace(testDir);

      expect(ignoreFile).toBe(join(testDir, ".gitignore"));
      expect(ig.ignores("git-ignore/")).toBe(true);
    });

    it("should use defaults when no ignore file exists", () => {
      const { ig, ignoreFile } = createIgnoreFromWorkspace(testDir);

      expect(ignoreFile).toBe(null);
      // Should still ignore default patterns
      expect(ig.ignores("node_modules/")).toBe(true);
      expect(ig.ignores(".git/")).toBe(true);
    });

    it("should always ignore .konveyor directory", () => {
      // Even with custom ignore file
      writeFileSync(join(testDir, ".gitignore"), "dist/\n");

      const { ig } = createIgnoreFromWorkspace(testDir);

      expect(ig.ignores(".konveyor/")).toBe(true);
      expect(ig.ignores(".konveyor/config.yaml")).toBe(true);
    });
  });

  describe("filterIgnoredPaths", () => {
    it("should filter paths that match ignore patterns", () => {
      const ig = ignore().add(["dist/", "*.log"]);
      const paths = ["src/", "dist/", "app.log", "readme.md"];

      const ignored = filterIgnoredPaths(paths, ig);

      expect(ignored).toContain("dist/");
      expect(ignored).toContain("app.log");
      expect(ignored).not.toContain("src/");
      expect(ignored).not.toContain("readme.md");
    });

    it("should handle nested directories correctly", () => {
      const ig = ignore().add(["dist/"]);
      const paths = ["dist/", "client/dist/", "packages/ui/dist/", "src/"];

      const ignored = filterIgnoredPaths(paths, ig);

      expect(ignored).toContain("dist/");
      expect(ignored).toContain("client/dist/");
      expect(ignored).toContain("packages/ui/dist/");
      expect(ignored).not.toContain("src/");
    });

    it("should handle negation patterns", () => {
      const ig = ignore().add(["*.log", "!important.log"]);
      const paths = ["error.log", "debug.log", "important.log"];

      const ignored = filterIgnoredPaths(paths, ig);

      expect(ignored).toContain("error.log");
      expect(ignored).toContain("debug.log");
      expect(ignored).not.toContain("important.log");
    });

    it("should handle rooted patterns", () => {
      const ig = ignore().add(["/dist/"]);
      const paths = ["dist/", "client/dist/"];

      const ignored = filterIgnoredPaths(paths, ig);

      // Only root-level dist should be ignored
      expect(ignored).toContain("dist/");
      expect(ignored).not.toContain("client/dist/");
    });
  });

  describe("isPathIgnored", () => {
    it("should check if a single path is ignored", () => {
      const ig = ignore().add(["dist/", "*.log"]);

      expect(isPathIgnored("dist/", ig)).toBe(true);
      expect(isPathIgnored("app.log", ig)).toBe(true);
      expect(isPathIgnored("src/", ig)).toBe(false);
    });

    it("should handle paths with leading ./", () => {
      const ig = ignore().add(["dist/"]);

      expect(isPathIgnored("./dist/", ig)).toBe(true);
      expect(isPathIgnored("./src/", ig)).toBe(false);
    });
  });

  describe("gitignore semantics (via ignore package)", () => {
    it("should match patterns at any directory level by default", () => {
      const ig = ignore().add(["dist/"]);

      expect(ig.ignores("dist/")).toBe(true);
      expect(ig.ignores("client/dist/")).toBe(true);
      expect(ig.ignores("a/b/c/dist/")).toBe(true);
    });

    it("should respect rooted patterns with leading /", () => {
      const ig = ignore().add(["/dist/"]);

      expect(ig.ignores("dist/")).toBe(true);
      expect(ig.ignores("client/dist/")).toBe(false);
    });

    it("should handle complex negation scenarios", () => {
      const ig = ignore().add(["*.log", "!important.log", "really-not-important.log"]);

      expect(ig.ignores("debug.log")).toBe(true);
      expect(ig.ignores("important.log")).toBe(false);
      // Pattern order matters in gitignore
    });

    it("should handle directory vs file patterns", () => {
      const ig = ignore().add(["logs/"]);

      // Directory pattern with trailing / only matches directories
      expect(ig.ignores("logs/")).toBe(true);
      expect(ig.ignores("logs/error.log")).toBe(true);
      // But "logs" as a file should not match "logs/" pattern
      // (though in practice files rarely have no extension)
    });

    it("should handle ** patterns", () => {
      const ig = ignore().add(["**/dist/"]);

      expect(ig.ignores("dist/")).toBe(true);
      expect(ig.ignores("client/dist/")).toBe(true);
      expect(ig.ignores("a/b/c/dist/")).toBe(true);
    });

    it("should handle realistic .gitignore content", () => {
      const content = `
# Build outputs
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

# But keep error logs
!error.log
`;
      const ig = ignore().add(content);

      expect(ig.ignores("dist/")).toBe(true);
      expect(ig.ignores("client/dist/")).toBe(true);
      expect(ig.ignores("node_modules/")).toBe(true);
      expect(ig.ignores("debug.log")).toBe(true);
      expect(ig.ignores("error.log")).toBe(false); // Negated
      expect(ig.ignores("src/")).toBe(false);
    });

    it("should handle escaped negation character (\\!)", () => {
      // \!important should match a literal file named "!important"
      // NOT be treated as a negation pattern
      const ig = ignore().add(["\\!important"]);

      expect(ig.ignores("!important")).toBe(true);
      // Regular files should not match
      expect(ig.ignores("important")).toBe(false);
    });

    it("should handle escaped hash character (\\#)", () => {
      // \#notes should match a literal file named "#notes"
      // NOT be treated as a comment
      const ig = ignore().add(["\\#notes"]);

      expect(ig.ignores("#notes")).toBe(true);
      expect(ig.ignores("notes")).toBe(false);
    });

    it("should handle escaped space character (\\ )", () => {
      // "my\ file" should match a file with a space in the name
      const ig = ignore().add(["my\\ file.txt"]);

      expect(ig.ignores("my file.txt")).toBe(true);
      expect(ig.ignores("myfile.txt")).toBe(false);
    });

    it("should distinguish between escaped and non-escaped patterns", () => {
      const ig = ignore().add([
        "*.log", // Ignore all .log files
        "!keep.log", // But don't ignore keep.log (negation)
        "\\!literal-bang.txt", // Ignore file literally named "!literal-bang.txt"
      ]);

      expect(ig.ignores("debug.log")).toBe(true);
      expect(ig.ignores("keep.log")).toBe(false); // Negated
      expect(ig.ignores("!literal-bang.txt")).toBe(true); // Escaped, matches literal
    });

    it("should handle trailing spaces correctly", () => {
      // Trailing spaces are significant in gitignore when escaped
      const ig = ignore().add(["trailing\\ "]);

      expect(ig.ignores("trailing ")).toBe(true);
      expect(ig.ignores("trailing")).toBe(false);
    });
  });

  describe("getIgnorePatternsForGlob (regression test for issue #1182)", () => {
    let testDir: string;

    beforeEach(() => {
      testDir = mkdtempSync(join(tmpdir(), "konveyor-test-glob-"));
    });

    afterEach(() => {
      if (testDir) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it("should return raw patterns from gitignore for glob operations", () => {
      writeFileSync(
        join(testDir, ".gitignore"),
        `target
dist
.vscode
`,
      );

      const patterns = getIgnorePatternsForGlob(testDir);

      expect(patterns).toContain(".konveyor"); // Always included
      expect(patterns).toContain("target");
      expect(patterns).toContain("dist");
      expect(patterns).toContain(".vscode");
    });

    it("should filter out comments and blank lines", () => {
      writeFileSync(
        join(testDir, ".gitignore"),
        `# This is a comment
target

# Another comment
dist
`,
      );

      const patterns = getIgnorePatternsForGlob(testDir);

      expect(patterns).toContain("target");
      expect(patterns).toContain("dist");
      expect(patterns).not.toContain("# This is a comment");
      expect(patterns).not.toContain("");
    });

    it("should work with globby to find only top-level matching directories", () => {
      // Create gitignore with "target"
      writeFileSync(join(testDir, ".gitignore"), "target\n");

      // Create target directory with many nested subdirectories
      const targetDir = join(testDir, "target");
      mkdirSync(targetDir);
      mkdirSync(join(targetDir, "classes"));
      mkdirSync(join(targetDir, "classes", "META-INF"));
      mkdirSync(join(targetDir, "classes", "com"));

      // Get patterns and use with globby
      const patterns = getIgnorePatternsForGlob(testDir);
      const matchedDirs = globbySync(patterns, {
        cwd: testDir,
        expandDirectories: false,
        dot: true,
        onlyDirectories: true,
        markDirectories: true,
        absolute: true,
        unique: true,
      });

      // Should find the target directory
      expect(matchedDirs.some((p) => p.includes("target"))).toBe(true);

      // Should NOT include nested subdirectories
      expect(matchedDirs.some((p) => p.includes("target/classes"))).toBe(false);
      expect(matchedDirs.some((p) => p.includes("META-INF"))).toBe(false);

      // Should return a small number of paths (not thousands)
      expect(matchedDirs.length).toBeLessThan(10);
    });

    it("should find directories at any nesting level when used with globby", () => {
      // Create gitignore with "dist"
      writeFileSync(join(testDir, ".gitignore"), "dist\n");

      // Create dist directories at multiple levels
      mkdirSync(join(testDir, "dist"));
      mkdirSync(join(testDir, "client"), { recursive: true });
      mkdirSync(join(testDir, "client", "dist"));
      mkdirSync(join(testDir, "packages", "ui"), { recursive: true });
      mkdirSync(join(testDir, "packages", "ui", "dist"));

      // Get patterns and use with globby
      const patterns = getIgnorePatternsForGlob(testDir);
      const matchedDirs = globbySync(patterns, {
        cwd: testDir,
        expandDirectories: false,
        dot: true,
        onlyDirectories: true,
        markDirectories: true,
        absolute: false,
        unique: true,
      });

      // Should find all dist directories at any level
      expect(matchedDirs).toContain("dist/");
      expect(matchedDirs).toContain("client/dist/");
      expect(matchedDirs).toContain("packages/ui/dist/");

      // Should be exactly 4 paths: .konveyor, dist, client/dist, packages/ui/dist
      const distPaths = matchedDirs.filter((p) => p.includes("dist"));
      expect(distPaths.length).toBe(3);
    });

    it("performance: should enable efficient directory discovery", () => {
      // This simulates the issue #1182 scenario where we want to
      // avoid scanning thousands of nested directories
      writeFileSync(join(testDir, ".gitignore"), "target\n");

      // Create a deep nested structure in target/
      let currentPath = join(testDir, "target");
      mkdirSync(currentPath);
      for (let i = 0; i < 100; i++) {
        currentPath = join(currentPath, `level${i}`);
        mkdirSync(currentPath);
      }

      // Get patterns and use with globby
      const patterns = getIgnorePatternsForGlob(testDir);
      const startTime = Date.now();
      const matchedDirs = globbySync(patterns, {
        cwd: testDir,
        expandDirectories: false,
        dot: true,
        onlyDirectories: true,
        markDirectories: true,
        absolute: false,
        unique: true,
      });
      const duration = Date.now() - startTime;

      // Should complete quickly
      expect(duration).toBeLessThan(1000);

      // Should find only the top-level target directory
      const targetPaths = matchedDirs.filter((p) => p.includes("target"));
      expect(targetPaths).toEqual(["target/"]);

      // Should NOT include any nested level directories
      expect(matchedDirs.some((p) => p.includes("level"))).toBe(false);
    });

    it("should prefer .konveyorignore over .gitignore", () => {
      writeFileSync(join(testDir, ".konveyorignore"), "custom-ignore\n");
      writeFileSync(join(testDir, ".gitignore"), "git-ignore\n");

      const patterns = getIgnorePatternsForGlob(testDir);

      expect(patterns).toContain("custom-ignore");
      expect(patterns).not.toContain("git-ignore");
    });

    it("should use defaults when no ignore file exists", () => {
      const patterns = getIgnorePatternsForGlob(testDir);

      expect(patterns).toContain(".konveyor");
      expect(patterns).toContain(".git");
      expect(patterns).toContain("node_modules");
      expect(patterns).toContain("target");
    });

    it("should always include .konveyor in patterns", () => {
      writeFileSync(join(testDir, ".gitignore"), "dist\n");

      const patterns = getIgnorePatternsForGlob(testDir);

      expect(patterns).toContain(".konveyor");
      expect(patterns).toContain("dist");
    });
  });
});
