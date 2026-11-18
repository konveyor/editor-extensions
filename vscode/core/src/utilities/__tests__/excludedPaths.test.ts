import expect from "expect";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import { resolveExcludedPaths, isDirectoryIgnored, alsoExcludes } from "../excludedPaths";
import { createIgnoreFromWorkspace, isPathIgnored } from "../ignorePatterns";

/**
 * The analyzer is handed a list of directories to skip. It skips everything
 * underneath each one, so a directory on that list must have an entirely
 * ignored subtree — otherwise analysis silently drops files the user asked to
 * keep.
 *
 * The previous implementation built the list by handing the raw ignore patterns
 * to globby as search patterns. globby matches them as plain globs rather than
 * as gitignore rules, so negations it could not match were dropped and the
 * ignored parent stayed on the list, excluding a re-included subtree.
 */
describe("excludedPaths module", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "konveyor-excluded-"));
  });

  afterEach(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  /** Create directories (posix-style relative paths) each holding one file. */
  const makeTree = (...relativeDirs: string[]): void => {
    for (const relativeDir of relativeDirs) {
      mkdirSync(join(testDir, relativeDir), { recursive: true });
      writeFileSync(join(testDir, relativeDir, "Example.java"), "class Example {}");
    }
  };

  const writeIgnoreFile = (...lines: string[]): void => {
    writeFileSync(join(testDir, ".gitignore"), `${lines.join("\n")}\n`);
  };

  /** Root-relative posix paths, without the directory marker. */
  const toRelative = (absolutePath: string): string =>
    absolutePath
      .slice(testDir.length + 1)
      .split(sep)
      .join("/")
      .replace(/\/$/, "");

  const excluded = (): string[] => resolveExcludedPaths(testDir).excludedPaths.map(toRelative);

  const skipped = (): string[] => resolveExcludedPaths(testDir).skippedPaths.map(toRelative);

  /**
   * Would the analyzer drop an incident reported in `relativePath`?
   *
   * This models what analyzer-lsp actually does with the list, rather than
   * assuming it treats each entry as a directory boundary: `ExcludedPathsScope`
   * runs every path through `filepath.Clean` (dropping the trailing separator
   * we add) and `FilterResponse` then compiles the result as an *unanchored*
   * regular expression and matches it against the incident's absolute file name
   * (engine/scopes.go). So an exclusion of `<root>/generated` drops incidents in
   * `<root>/generated-api/App.java` too, even though that file is not inside it.
   */
  const isExcludedByAnalyzer = (relativePath: string): boolean => {
    const incidentFile = join(testDir, relativePath);
    return resolveExcludedPaths(testDir).excludedPaths.some((excludedPath) => {
      const cleaned = excludedPath.endsWith(sep)
        ? excludedPath.slice(0, -sep.length)
        : excludedPath;
      return new RegExp(cleaned).test(incidentFile);
    });
  };

  describe("resolveExcludedPaths", () => {
    it("reports the ignore file the patterns came from", () => {
      makeTree("src");
      writeIgnoreFile("target/");

      expect(resolveExcludedPaths(testDir).ignoreFile).toBe(join(testDir, ".gitignore"));
    });

    it("falls back to the default patterns when no ignore file is present", () => {
      makeTree("src/main", "node_modules/left-pad", "target/classes");

      const result = resolveExcludedPaths(testDir);

      expect(result.ignoreFile).toBe(null);
      expect(excluded()).toContain("node_modules");
      expect(excluded()).toContain("target");
      expect(excluded()).not.toContain("src");
    });

    it("always excludes the .konveyor directory", () => {
      makeTree(".konveyor/analysis", "src");
      writeIgnoreFile("target/");

      expect(excluded()).toContain(".konveyor");
    });

    it("returns absolute, directory-marked paths", () => {
      makeTree("target/classes", "src");
      writeIgnoreFile("target/");

      expect(resolveExcludedPaths(testDir).excludedPaths).toEqual([join(testDir, "target") + sep]);
    });

    it("excludes only the ignored directory, not its already-covered children", () => {
      makeTree("target/classes/com", "src/main");
      writeIgnoreFile("target/");

      // One entry covers the whole subtree; listing children as well would be noise.
      expect(excluded()).toEqual(["target"]);
    });

    it("excludes ignored directories at any depth", () => {
      makeTree("target", "modules/api/target", "modules/api/src");
      writeIgnoreFile("target/");

      expect(excluded()).toEqual(["modules/api/target", "target"]);
    });

    it("honours rooted patterns", () => {
      makeTree("target", "modules/api/target");
      writeIgnoreFile("/target");

      // Rooted patterns only match at the workspace root.
      expect(excluded()).toEqual(["target"]);
    });

    it("leaves nothing excluded when the ignore file only lists files", () => {
      makeTree("src/main");
      writeIgnoreFile("*.log", "secrets.txt");

      expect(excluded()).toEqual([]);
    });

    describe("negation", () => {
      it("does not exclude a directory a negation re-includes", () => {
        makeTree("target/classes", "modules/api/target", "src");
        // Ignore target dirs everywhere, but keep the one at the root.
        writeIgnoreFile("target/", "!/target/");

        const result = excluded();

        expect(result).toContain("modules/api/target");
        expect(result).not.toContain("target");
        expect(isExcludedByAnalyzer("target/classes/Example.java")).toBe(false);
      });

      it("descends into an ignored directory that re-includes a direct child", () => {
        makeTree("fixtures/keep", "fixtures/drop", "src");
        writeIgnoreFile("fixtures/*", "!fixtures/keep/");

        const result = excluded();

        expect(result).toContain("fixtures/drop");
        expect(result).not.toContain("fixtures");
        expect(isExcludedByAnalyzer("fixtures/keep/Example.java")).toBe(false);
      });

      it("descends into an ignored directory that re-includes a deeper descendant", () => {
        makeTree("fixtures/a/keep", "fixtures/a/drop", "fixtures/b");
        writeIgnoreFile("fixtures/**", "!fixtures/a/", "!fixtures/a/keep/");

        const result = excluded();

        expect(result).toContain("fixtures/b");
        expect(result).toContain("fixtures/a/drop");
        expect(result).not.toContain("fixtures");
        expect(result).not.toContain("fixtures/a");
        expect(isExcludedByAnalyzer("fixtures/a/keep/Example.java")).toBe(false);
      });

      it("excludes a re-included directory's ignored siblings", () => {
        makeTree("build/keep", "build/generated", "build/tmp");
        writeIgnoreFile("build/*", "!build/keep");

        expect(excluded()).toEqual(["build/generated", "build/tmp"]);
      });

      it("still excludes everything when a negation is shadowed by an ignored parent", () => {
        makeTree("fixtures/keep/deep", "src");
        // gitignore cannot re-include below an excluded directory, so `fixtures`
        // (and all of it) stays ignored despite the negation.
        writeIgnoreFile("fixtures/", "!fixtures/keep/");

        expect(excluded()).toEqual(["fixtures"]);
        expect(isPathIgnored("fixtures/keep", createIgnoreFromWorkspace(testDir).ig)).toBe(true);
      });
    });

    /**
     * The analyzer matches an excluded path as a prefix, not as a directory, so
     * an excluded directory whose name starts another neighbour's name takes
     * that neighbour down with it. Rather than over-exclude, such a directory is
     * left off the list: over-exclusion loses incidents in files the user wanted
     * analyzed, under-exclusion only reports incidents in files they ignored.
     */
    describe("neighbours the analyzer would also exclude", () => {
      it("does not exclude a directory whose name starts a sibling the ignore rules accept", () => {
        makeTree("generated", "generated-api", "src");
        writeIgnoreFile("/generated");

        expect(excluded()).toEqual([]);
        expect(skipped()).toEqual(["generated"]);
        expect(isExcludedByAnalyzer("generated-api/Example.java")).toBe(false);
      });

      it("does not exclude a directory whose name starts an accepted file's name", () => {
        makeTree("generated");
        writeFileSync(join(testDir, "generated.txt"), "keep me");
        writeIgnoreFile("/generated");

        expect(excluded()).toEqual([]);
        expect(skipped()).toEqual(["generated"]);
        expect(isExcludedByAnalyzer("generated.txt")).toBe(false);
      });

      it("still excludes it when the sibling it would reach is ignored too", () => {
        makeTree("generated", "generated-api", "src");
        writeIgnoreFile("generated*");

        // Sorted by the emitted path, where the directory marker puts
        // `generated-api/` ahead of `generated/`.
        expect(excluded()).toEqual(["generated-api", "generated"]);
        expect(skipped()).toEqual([]);
      });

      it("applies below the workspace root as well", () => {
        makeTree("build/out", "build/output-api", "src");
        writeIgnoreFile("build/out/");

        expect(excluded()).toEqual([]);
        expect(skipped()).toEqual(["build/out"]);
        expect(isExcludedByAnalyzer("build/output-api/Example.java")).toBe(false);
      });

      it("excludes a directory whose name merely ends like a sibling's", () => {
        makeTree("api-generated", "generated", "src");
        writeIgnoreFile("/generated");

        // `<root>/generated` is not a prefix of `<root>/api-generated`.
        expect(excluded()).toEqual(["generated"]);
        expect(isExcludedByAnalyzer("api-generated/Example.java")).toBe(false);
      });
    });

    describe("agreement with the ignore rules", () => {
      const allDirs = [
        "fixtures",
        "fixtures/keep",
        "fixtures/keep/deep",
        "fixtures/drop",
        "generated",
        "generated-api",
        "target",
        "target/classes",
        "modules",
        "modules/api",
        "modules/api/target",
        "node_modules",
        "node_modules/left-pad",
        "src",
        "src/main",
      ];

      const patternSets = [
        ["target/"],
        ["target/", "!/target/"],
        ["fixtures/", "!fixtures/keep/"],
        ["fixtures/*", "!fixtures/keep/"],
        ["fixtures/*", "!fixtures/keep"],
        ["/node_modules", "/target"],
        ["/generated"],
        ["*", "!src/", "!src/**"],
        ["node_modules", "target", "fixtures/drop"],
      ];

      for (const patterns of patternSets) {
        it(`never excludes a path the ignore rules accept: ${JSON.stringify(patterns)}`, () => {
          makeTree(...allDirs);
          writeIgnoreFile(...patterns);

          const { ig } = createIgnoreFromWorkspace(testDir);
          const accepted = allDirs.filter((d) => !isPathIgnored(d, ig));

          for (const dir of accepted) {
            // Both the directory and the file in it: the analyzer filters
            // incidents, which are always files.
            expect({ dir, excluded: isExcludedByAnalyzer(dir) }).toEqual({ dir, excluded: false });
            expect({
              dir,
              excluded: isExcludedByAnalyzer(`${dir}/Example.java`),
            }).toEqual({ dir, excluded: false });
          }
        });

        it(`accounts for every ignored directory: ${JSON.stringify(patterns)}`, () => {
          makeTree(...allDirs);
          writeIgnoreFile(...patterns);

          const { ig } = createIgnoreFromWorkspace(testDir);
          const ignoredDirs = allDirs.filter((d) => isDirectoryIgnored(d, ig));
          // Excluded, or deliberately skipped because excluding it would have
          // reached a neighbour the ignore rules accept.
          const accountedFor = [...excluded(), ...skipped()];

          for (const dir of ignoredDirs) {
            expect({
              dir,
              accountedFor: accountedFor.some((e) => dir === e || dir.startsWith(`${e}/`)),
            }).toEqual({ dir, accountedFor: true });
          }
        });
      }
    });

    describe("walk safety", () => {
      it("does not follow symbolic links", () => {
        makeTree("a/b");
        // A link back to the root would be an endless walk if followed.
        symlinkSync(testDir, join(testDir, "a", "loop"));
        writeIgnoreFile("target/");

        const result = resolveExcludedPaths(testDir);

        expect(result.excludedPaths).toEqual([]);
        // Following the link would spin until the directory budget ran out.
        expect(result.truncated).toBe(false);
      });

      it("excludes an ignored symlink that points at a directory", () => {
        makeTree("node_modules/left-pad", "src");
        symlinkSync(join(testDir, "node_modules"), join(testDir, "src", "vendor"));
        writeIgnoreFile("node_modules", "vendor");

        expect(excluded()).toEqual(["node_modules", "src/vendor"]);
      });

      it("stops and warns once the directory budget is spent", () => {
        makeTree("a/b/c/d/e", "src");
        const warnings: string[] = [];

        const result = resolveExcludedPaths(testDir, {
          maxDirectories: 2,
          onWarning: (message) => warnings.push(message),
        });

        expect(result.truncated).toBe(true);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain("Stopped resolving excluded paths");
      });

      it("warns and keeps going when a directory cannot be read", () => {
        makeTree("src");
        const warnings: string[] = [];

        const result = resolveExcludedPaths(join(testDir, "does-not-exist"), {
          onWarning: (message) => warnings.push(message),
        });

        expect(result.excludedPaths).toEqual([]);
        expect(result.truncated).toBe(false);
        expect(warnings.length).toBe(1);
        expect(warnings[0]).toContain("Could not read directory");
      });
    });
  });

  describe("isDirectoryIgnored", () => {
    it("matches directory-only patterns", () => {
      writeIgnoreFile("target/");
      const { ig } = createIgnoreFromWorkspace(testDir);

      expect(isDirectoryIgnored("target", ig)).toBe(true);
      expect(isDirectoryIgnored("target/", ig)).toBe(true);
      expect(isDirectoryIgnored("./target", ig)).toBe(true);
      expect(isDirectoryIgnored("src", ig)).toBe(false);
    });

    it("respects a negation that re-includes a directory", () => {
      writeIgnoreFile("fixtures/*", "!fixtures/keep/");
      const { ig } = createIgnoreFromWorkspace(testDir);

      expect(isDirectoryIgnored("fixtures/drop", ig)).toBe(true);
      expect(isDirectoryIgnored("fixtures/keep", ig)).toBe(false);
    });
  });

  describe("alsoExcludes", () => {
    const excludedPath = join("/repo", "generated") + sep;

    it("reaches a path that merely starts with the excluded directory's path", () => {
      expect(alsoExcludes(excludedPath, join("/repo", "generated-api", "App.java"))).toBe(true);
      expect(alsoExcludes(excludedPath, join("/repo", "generated.txt"))).toBe(true);
    });

    it("reaches paths inside the excluded directory", () => {
      expect(alsoExcludes(excludedPath, join("/repo", "generated", "App.java"))).toBe(true);
    });

    it("leaves unrelated paths alone", () => {
      expect(alsoExcludes(excludedPath, join("/repo", "src", "App.java"))).toBe(false);
      expect(alsoExcludes(excludedPath, join("/repo", "api-generated", "App.java"))).toBe(false);
    });
  });
});
