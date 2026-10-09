import expect from "expect";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import winston from "winston";
import { AgentFileTracker } from "../fileTracker";

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
    await write("D.java", "v2");
    tracker.cacheFileBeforeWrite("text_editor", { command: "str_replace", path: abs }, workspace);
    expect(await tracker.resolvePendingFileChanges()).toEqual([
      { path: abs, content: "v2", originalContent: "v1" },
    ]);
  });

  it("cacheIncidentFiles returns only files that exist", async () => {
    const abs = await write("E.java", "v1");
    const missing = path.join(workspace, "Missing.java");
    tracker.cacheFileBeforeWrite("write_file", { path: missing }, workspace);
    await tracker.resolvePendingFileChanges(); // flush the inflight read
    const cache = await tracker.cacheIncidentFiles([{ uri: abs }, { uri: missing }], workspace);
    expect(Array.from(cache.entries())).toEqual([[abs, "v1"]]);
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
