import expect from "expect";
import { isPathIgnoredInRoot, resetIgnoreCache } from "../multiRootIgnore";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
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
