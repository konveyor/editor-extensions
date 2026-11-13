import expect from "expect";
import {
  isPathIgnoredInRoot,
  resetIgnoreCache,
  scopeExcludedPathsToRoot,
} from "../multiRootIgnore";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";

/**
 * Multi-root ignore checks (issue #758): each workspace folder is judged
 * against its own ignore files, and files in non-first folders are no
 * longer dropped just for being outside the first folder.
 */

describe("multiRootIgnore module", () => {
  let rootA: string;
  let rootB: string;

  beforeEach(() => {
    rootA = mkdtempSync(join(tmpdir(), "konveyor-rootA-"));
    rootB = mkdtempSync(join(tmpdir(), "konveyor-rootB-"));
    resetIgnoreCache();
  });

  afterEach(() => {
    for (const dir of [rootA, rootB]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("judges each root by its own ignore file", () => {
    writeFileSync(join(rootA, ".gitignore"), "target/\n");
    writeFileSync(join(rootB, ".konveyorignore"), "dist/\n");

    expect(isPathIgnoredInRoot(rootA, join(rootA, "target", "App.class"))).toBe(true);
    expect(isPathIgnoredInRoot(rootB, join(rootB, "target", "App.class"))).toBe(false);
    expect(isPathIgnoredInRoot(rootB, join(rootB, "dist", "bundle.js"))).toBe(true);
    expect(isPathIgnoredInRoot(rootA, join(rootA, "dist", "bundle.js"))).toBe(false);
  });

  it("does not ignore a plain source file in a second root", () => {
    writeFileSync(join(rootB, ".gitignore"), "build/\n");
    expect(isPathIgnoredInRoot(rootB, join(rootB, "src", "main", "App.java"))).toBe(false);
  });

  it("falls back to default patterns when a root has no ignore file", () => {
    expect(isPathIgnoredInRoot(rootA, join(rootA, "node_modules", "pkg", "index.js"))).toBe(true);
    expect(isPathIgnoredInRoot(rootA, join(rootA, "src", "index.js"))).toBe(false);
  });

  it("always ignores the .konveyor directory in every root", () => {
    writeFileSync(join(rootA, ".gitignore"), "target/\n");
    expect(isPathIgnoredInRoot(rootA, join(rootA, ".konveyor"))).toBe(true);
    expect(isPathIgnoredInRoot(rootA, join(rootA, ".konveyor", "analysis.json"))).toBe(true);
    expect(isPathIgnoredInRoot(rootB, join(rootB, ".konveyor", "analysis.json"))).toBe(true);
  });

  it("ignores paths outside the given root", () => {
    expect(isPathIgnoredInRoot(rootA, join(rootB, "src", "App.java"))).toBe(true);
    expect(isPathIgnoredInRoot(rootA, rootA)).toBe(true);
  });

  it("re-reads ignore files after resetIgnoreCache", () => {
    expect(isPathIgnoredInRoot(rootA, join(rootA, "generated", "x.java"))).toBe(false);

    writeFileSync(join(rootA, ".konveyorignore"), "generated/\n");
    // Memoized instance still answers from the old state...
    expect(isPathIgnoredInRoot(rootA, join(rootA, "generated", "x.java"))).toBe(false);

    resetIgnoreCache();
    expect(isPathIgnoredInRoot(rootA, join(rootA, "generated", "x.java"))).toBe(true);
  });

  it("keeps per-root instances independent", () => {
    mkdirSync(join(rootA, "sub"));
    writeFileSync(join(rootA, ".gitignore"), "sub/\n");

    expect(isPathIgnoredInRoot(rootA, join(rootA, "sub", "f.txt"))).toBe(true);
    // rootB has no ignore file; "sub" is not in the defaults.
    expect(isPathIgnoredInRoot(rootB, join(rootB, "sub", "f.txt"))).toBe(false);
  });
});

describe("scopeExcludedPathsToRoot", () => {
  let repo: string;

  const mkdirs = (...segments: string[]) => mkdirSync(join(repo, ...segments), { recursive: true });
  const sorted = (paths: string[]) => [...paths].sort();

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "konveyor-nested-"));
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("does not let a parent exclusion cover a nested root, in either root order", () => {
    mkdirs("apps", "service", "src");
    mkdirs("apps", "other");
    writeFileSync(join(repo, "apps", "notes.txt"), "");
    const service = join(repo, "apps", "service");

    for (const roots of [
      [service, repo],
      [repo, service],
    ]) {
      expect(sorted(scopeExcludedPathsToRoot(repo, [join(repo, "apps") + "/"], roots))).toEqual([
        join(repo, "apps", "notes.txt"),
        join(repo, "apps", "other"),
      ]);
    }
  });

  it("narrows through intermediate directories down to a deeply nested root", () => {
    mkdirs("apps", "group", "service");
    mkdirs("apps", "group", "sibling");
    mkdirs("apps", "other");
    const service = join(repo, "apps", "group", "service");

    expect(sorted(scopeExcludedPathsToRoot(repo, [join(repo, "apps")], [repo, service]))).toEqual([
      join(repo, "apps", "group", "sibling"),
      join(repo, "apps", "other"),
    ]);
  });

  it("drops an exclusion that is exactly another root", () => {
    mkdirs("apps", "service");
    const service = join(repo, "apps", "service");

    expect(scopeExcludedPathsToRoot(repo, [service], [repo, service])).toEqual([]);
  });

  it("leaves paths inside a nested root to that root's own rules", () => {
    mkdirs("apps", "service", "generated");
    mkdirs("apps", "service", "target");
    const service = join(repo, "apps", "service");
    const generated = join(service, "generated");
    const target = join(service, "target");

    expect(scopeExcludedPathsToRoot(repo, [generated], [repo, service])).toEqual([]);
    expect(scopeExcludedPathsToRoot(service, [target], [repo, service])).toEqual([target]);
  });

  it("does not let a name prefix cover a sibling root, since the analyzer matches unanchored", () => {
    mkdirs("build", "out");
    mkdirs("build-tools", "src");
    const buildTools = join(repo, "build-tools");

    expect(scopeExcludedPathsToRoot(repo, [join(repo, "build")], [repo, buildTools])).toEqual([
      join(repo, "build", "out"),
    ]);
  });

  // Off Windows the analyzer compiles an excluded path as a regex unquoted.
  const itWhereDotIsWildcard = sep === "/" ? it : it.skip;

  itWhereDotIsWildcard(
    "does not emit an ignored sibling whose name matches a nested root as a regex",
    () => {
      mkdirs("apps", "service-v1", "src");
      mkdirs("apps", "service.v1", "src");
      mkdirs("apps", "other");
      const service = join(repo, "apps", "service-v1");

      const scoped = scopeExcludedPathsToRoot(repo, [join(repo, "apps") + "/"], [repo, service]);

      expect(scoped).toEqual([join(repo, "apps", "other")]);
      for (const excluded of scoped) {
        expect(new RegExp(excluded).test(join(service, "src", "Main.java"))).toBe(false);
      }
    },
  );

  itWhereDotIsWildcard("drops a path under a sibling whose name matches a nested root", () => {
    mkdirs("apps", "service-v1", "target");
    mkdirs("apps", "service.v1", "target");
    const service = join(repo, "apps", "service-v1");

    expect(
      scopeExcludedPathsToRoot(repo, [join(repo, "apps", "service.v1", "target")], [repo, service]),
    ).toEqual([]);
  });

  itWhereDotIsWildcard("does not let one root's exclusion match a root beside it", () => {
    mkdirs("app.v1", "target");
    mkdirs("app-v1", "target");
    const dotted = join(repo, "app.v1");
    const dashed = join(repo, "app-v1");

    expect(scopeExcludedPathsToRoot(dotted, [join(dotted, "target")], [dotted, dashed])).toEqual(
      [],
    );
    expect(scopeExcludedPathsToRoot(dashed, [join(dashed, "target")], [dotted, dashed])).toEqual([
      join(dashed, "target"),
    ]);
  });

  itWhereDotIsWildcard(
    "drops an exclusion whose wildcard can stand for a separator below another root",
    () => {
      mkdirs("app.v1", "generated");
      mkdirs("app", "v1", "generated");
      mkdirs("lib", "generated");
      const dotted = join(repo, "app.v1");
      const app = join(repo, "app");
      const lib = join(repo, "lib");
      const generated = join(dotted, "generated") + "/";

      // The analyzer would match this against /repo/app/v1/generated/Main.java.
      expect(new RegExp(generated).test(join(app, "v1", "generated", "Main.java"))).toBe(true);
      expect(scopeExcludedPathsToRoot(dotted, [generated], [dotted, app])).toEqual([]);
      // It holds before the directory exists, too.
      rmSync(join(app, "v1"), { recursive: true });
      expect(scopeExcludedPathsToRoot(dotted, [generated], [dotted, app])).toEqual([]);
      // A root the pattern cannot land in leaves it alone.
      expect(scopeExcludedPathsToRoot(dotted, [generated], [dotted, lib])).toEqual([generated]);
    },
  );

  itWhereDotIsWildcard("keeps a dotted exclusion that cannot land in another root", () => {
    mkdirs(".cache");
    mkdirs("apps", "service");
    const service = join(repo, "apps", "service");

    expect(scopeExcludedPathsToRoot(repo, [join(repo, ".cache")], [repo, service])).toEqual([
      join(repo, ".cache"),
    ]);
  });

  it("keeps a nested root's own exclusions when its parent is also a root", () => {
    mkdirs("apps", "service", "target");
    const service = join(repo, "apps", "service");
    const target = join(service, "target");

    expect(scopeExcludedPathsToRoot(service, [target], [service, repo])).toEqual([target]);
  });

  it("keeps exclusions that do not touch another root", () => {
    mkdirs("target");
    mkdirs("apps", "service");
    const service = join(repo, "apps", "service");

    expect(scopeExcludedPathsToRoot(repo, [join(repo, "target")], [repo, service])).toEqual([
      join(repo, "target"),
    ]);
  });

  it("returns paths untouched in a single-root workspace", () => {
    const excluded = [join(repo, "target") + "/"];

    expect(scopeExcludedPathsToRoot(repo, excluded, [repo])).toEqual(excluded);
  });
});
