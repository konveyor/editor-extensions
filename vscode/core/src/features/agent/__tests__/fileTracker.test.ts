import expect from "expect";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import winston from "winston";
import { AgentFileTracker, getToolFilePath } from "../fileTracker";

const silentLogger = winston.createLogger({ silent: true, transports: [] });

describe("AgentFileTracker", () => {
  let workspace: string;
  let tracker: AgentFileTracker;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "konveyor-file-tracker-"));
    tracker = new AgentFileTracker(silentLogger);
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  async function write(rel: string, content: string): Promise<string> {
    const abs = path.join(workspace, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
    return abs;
  }

  /**
   * cacheFileBeforeWrite reads the baseline asynchronously. Wait for that read
   * before the test overwrites the file, or the read can observe the truncated
   * file mid-write (an empty baseline). A scan flushes inflight reads.
   */
  async function flushBaselineReads(): Promise<void> {
    await tracker.resolvePendingFileChanges();
  }

  it("detects a file the agent creates", async () => {
    const abs = path.join(workspace, "src", "New.java");
    tracker.cacheFileBeforeWrite("text_editor", { command: "create", path: abs }, workspace);

    // Nothing on disk yet: no change to report, but the file stays tracked.
    expect(await tracker.resolvePendingFileChanges()).toEqual([]);

    await write("src/New.java", "class New {}");
    const changes = await tracker.resolvePendingFileChanges();
    expect(changes).toEqual([{ path: abs, content: "class New {}", originalContent: "" }]);
    expect(await tracker.getOriginalContent(abs)).toBeUndefined();
  });

  it("reports a second edit to the same file against the original baseline", async () => {
    const abs = await write("A.java", "v1");
    await tracker.cacheIncidentFiles([{ uri: abs }], workspace);

    await write("A.java", "v2");
    expect(await tracker.resolvePendingFileChanges()).toEqual([
      { path: abs, content: "v2", originalContent: "v1" },
    ]);

    // Unchanged since the last routing: nothing new.
    expect(await tracker.resolvePendingFileChanges()).toEqual([]);

    await write("A.java", "v3");
    expect(await tracker.resolvePendingFileChanges()).toEqual([
      { path: abs, content: "v3", originalContent: "v1" },
    ]);
  });

  it("post-scan reports only changes not routed yet and marks them routed", async () => {
    const abs = await write("B.java", "v1");
    await tracker.cacheIncidentFiles([{ uri: abs }], workspace);

    await write("B.java", "v2");
    expect(await tracker.resolvePendingFileChanges()).toHaveLength(1);
    expect(await tracker.scanForMissedChanges()).toEqual([]);

    await write("B.java", "v3");
    expect(await tracker.scanForMissedChanges()).toEqual([
      { path: abs, content: "v3", originalContent: "v1" },
    ]);
    expect(await tracker.scanForMissedChanges()).toEqual([]);
  });

  it("does not report a file written back to its last routed content", async () => {
    const abs = await write("C.java", "v1");
    await tracker.cacheIncidentFiles([{ uri: abs }], workspace);
    await write("C.java", "v2");
    await tracker.resolvePendingFileChanges();
    await write("C.java", "v2");
    expect(await tracker.resolvePendingFileChanges()).toEqual([]);
  });

  it("ignores read-only text_editor commands and keeps the first baseline", async () => {
    const abs = await write("D.java", "v1");
    tracker.cacheFileBeforeWrite("text_editor", { command: "view", path: abs }, workspace);
    expect(await tracker.resolvePendingFileChanges()).toEqual([]);

    tracker.cacheFileBeforeWrite("text_editor", { command: "str_replace", path: abs }, workspace);
    await flushBaselineReads();
    await write("D.java", "v2");
    tracker.cacheFileBeforeWrite("text_editor", { command: "str_replace", path: abs }, workspace);
    expect(await tracker.resolvePendingFileChanges()).toEqual([
      { path: abs, content: "v2", originalContent: "v1" },
    ]);
  });

  it("tracks the target of a text_editor undo_edit like any other write", async () => {
    const abs = await write("G.java", "v2");
    tracker.cacheFileBeforeWrite("text_editor", { command: "undo_edit", path: abs }, workspace);
    await flushBaselineReads();
    await write("G.java", "v1");
    expect(await tracker.resolvePendingFileChanges()).toEqual([
      { path: abs, content: "v1", originalContent: "v2" },
    ]);
  });

  it("recognizes OpenCode's filePath argument and filepath permission metadata", async () => {
    const edited = await write("H.java", "v1");
    const created = path.join(workspace, "I.java");

    // Pre-write permission request: metadata uses `filepath`.
    tracker.cacheFileBeforeWrite("edit", { filepath: edited, diff: "..." }, workspace);
    // tool_call_update: the edit/write tool input uses `filePath`.
    tracker.cacheFileBeforeWrite("write", { filePath: created, content: "class I {}" }, workspace);
    await flushBaselineReads();

    await write("H.java", "v2");
    await write("I.java", "class I {}");
    const changes = await tracker.resolvePendingFileChanges();
    changes.sort((a, b) => a.path.localeCompare(b.path));
    expect(changes).toEqual([
      { path: edited, content: "v2", originalContent: "v1" },
      { path: created, content: "class I {}", originalContent: "" },
    ]);
  });

  it("tracks files named only by ACP locations", async () => {
    const abs = await write("J.java", "v1");
    tracker.cacheFileBeforeWrite("edit", {}, workspace, [abs]);
    await flushBaselineReads();
    await write("J.java", "v2");
    expect(await tracker.resolvePendingFileChanges()).toEqual([
      { path: abs, content: "v2", originalContent: "v1" },
    ]);
  });

  it("getToolFilePath reads whichever path key the agent uses", () => {
    expect(getToolFilePath({ path: "a" })).toBe("a");
    expect(getToolFilePath({ file_path: "b" })).toBe("b");
    expect(getToolFilePath({ filePath: "c" })).toBe("c");
    expect(getToolFilePath({ filepath: "d" })).toBe("d");
    expect(getToolFilePath({ filename: "e" })).toBe("e");
    expect(getToolFilePath({ command: "view" })).toBeUndefined();
    expect(getToolFilePath(undefined)).toBeUndefined();
  });

  it("cacheIncidentFiles returns only files that exist", async () => {
    const abs = await write("E.java", "v1");
    const missing = path.join(workspace, "Missing.java");
    tracker.cacheFileBeforeWrite("write_file", { path: missing }, workspace);
    await tracker.resolvePendingFileChanges(); // flush the inflight read
    const cache = await tracker.cacheIncidentFiles([{ uri: abs }, { uri: missing }], workspace);
    expect(Array.from(cache.entries())).toEqual([[abs, "v1"]]);
  });

  it("whenIdle waits for baseline reads and registered routing, and is undefined when idle", async () => {
    expect(tracker.whenIdle()).toBeUndefined();

    const abs = await write("K.java", "v1");
    tracker.cacheFileBeforeWrite("text_editor", { command: "str_replace", path: abs }, workspace);
    expect(tracker.whenIdle()).toBeDefined();
    await tracker.whenIdle();
    expect(tracker.whenIdle()).toBeUndefined();

    // Routing that follows a scan (a late approved write finishing during a
    // cancel) must complete before the next turn clears the tracker.
    let routed = false;
    await write("K.java", "v2");
    tracker.trackRouting(
      tracker.resolvePendingFileChanges().then(async (changes) => {
        await new Promise((r) => setTimeout(r, 5));
        routed = changes.length === 1;
      }),
    );
    expect(tracker.whenIdle()).toBeDefined();
    await tracker.whenIdle();
    expect(routed).toBe(true);
    expect(tracker.whenIdle()).toBeUndefined();
  });

  it("clear() forgets baselines and routed state", async () => {
    const abs = await write("F.java", "v1");
    await tracker.cacheIncidentFiles([{ uri: abs }], workspace);
    await write("F.java", "v2");
    await tracker.resolvePendingFileChanges();

    tracker.clear();
    expect(await tracker.resolvePendingFileChanges()).toEqual([]);

    // Re-tracked from the current content.
    await tracker.cacheIncidentFiles([{ uri: abs }], workspace);
    await write("F.java", "v3");
    expect(await tracker.resolvePendingFileChanges()).toEqual([
      { path: abs, content: "v3", originalContent: "v2" },
    ]);
  });
});

describe("AgentFileTracker afterWrite sightings (#1389 self-review)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execFileSync } = require("child_process") as typeof import("child_process");
  let repo: string;
  let tracker: AgentFileTracker;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "konveyor-tracker-git-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    await fs.writeFile(path.join(repo, "A.java"), "v1", "utf-8");
    git("add", "A.java");
    git("commit", "-q", "-m", "init");
    tracker = new AgentFileTracker(silentLogger);
  });

  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it("uses git HEAD, not the already-edited disk content, as the baseline", async () => {
    const abs = path.join(repo, "A.java");
    await fs.writeFile(abs, "v2", "utf-8"); // the agent's edit already landed
    tracker.cacheFileBeforeWrite("edit", { filePath: abs }, repo, undefined, { afterWrite: true });
    expect(await tracker.resolvePendingFileChanges()).toEqual([
      { path: abs, content: "v2", originalContent: "v1" },
    ]);
  });

  it("reports a file git has no copy of as new", async () => {
    const abs = path.join(repo, "New.java");
    await fs.writeFile(abs, "class New {}", "utf-8");
    tracker.cacheFileBeforeWrite("write", { filePath: abs }, repo, undefined, { afterWrite: true });
    expect(await tracker.resolvePendingFileChanges()).toEqual([
      { path: abs, content: "class New {}", originalContent: "" },
    ]);
  });

  it("keeps an earlier pre-write baseline over a later afterWrite sighting", async () => {
    const abs = path.join(repo, "A.java");
    await fs.writeFile(abs, "v1-local", "utf-8"); // uncommitted user change
    tracker.cacheFileBeforeWrite("edit", { filePath: abs }, repo);
    await tracker.resolvePendingFileChanges(); // flush the baseline read
    await fs.writeFile(abs, "v2", "utf-8");
    tracker.cacheFileBeforeWrite("edit", { filePath: abs }, repo, undefined, { afterWrite: true });
    expect(await tracker.resolvePendingFileChanges()).toEqual([
      { path: abs, content: "v2", originalContent: "v1-local" },
    ]);
  });
});
