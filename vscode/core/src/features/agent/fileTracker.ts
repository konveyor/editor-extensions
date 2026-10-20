/**
 * AgentFileTracker: Tracks file state before/during an agent run to detect
 * modifications made by the agent's own file tools.
 *
 * Baselines are captured from two sources:
 * - cacheIncidentFiles: pre-caches all files referenced by analysis incidents
 * - cacheFileBeforeWrite: caches files targeted by tool calls / permission
 *   requests. A file that does not exist yet gets a "missing" baseline so its
 *   creation is detected too.
 *
 * On every successful tool completion, resolvePendingFileChanges scans all
 * tracked files and routes changes to the chat / batch review. A file can be
 * routed more than once: each scan compares the on-disk content with the
 * content that was last routed, while the reported `originalContent` always
 * stays the pre-run baseline so reviewers see the cumulative diff.
 * A post-completion scan (scanForMissedChanges) catches anything missed.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import type winston from "winston";

export interface TrackedFileChange {
  path: string;
  content: string;
  originalContent?: string;
}

/**
 * Argument keys agents use for the file a tool targets. Goose's text_editor
 * uses `path`; OpenCode's edit/write tools use `filePath` and its pre-write
 * permission metadata uses `filepath`.
 */
const FILE_PATH_KEYS = ["path", "file_path", "filePath", "filepath", "filename"] as const;

/** The file a tool call targets, from whichever argument key the agent uses. */
export function getToolFilePath(args?: Record<string, unknown>): string | undefined {
  if (!args) {
    return undefined;
  }
  for (const key of FILE_PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return undefined;
}

/** Pre-run content of a tracked file; `null` means the file did not exist. */
type Baseline = string | null;

export class AgentFileTracker {
  private readonly originalContentCache = new Map<string, Baseline>();
  /** Content a file had when it was last routed to the chat / batch review. */
  private readonly lastRoutedContent = new Map<string, string>();
  private readonly inflightReads = new Map<string, Promise<void>>();
  /** Routing work (scan + routeFileChange) registered via trackRouting. */
  private readonly pendingRouting = new Set<Promise<unknown>>();
  private readonly logger: winston.Logger;
  private scanPromise: Promise<TrackedFileChange[]> | null = null;

  constructor(logger: winston.Logger) {
    this.logger = logger.child({ component: "AgentFileTracker" });
  }

  /**
   * Pre-read files referenced by analysis incidents so we have the
   * original content before the agent modifies them on disk.
   * Returns the content of every tracked file that exists.
   */
  async cacheIncidentFiles(
    incidents: ReadonlyArray<{ readonly uri: string }>,
    workspaceRoot: string,
  ): Promise<Map<string, string>> {
    const uniquePaths = new Set<string>();
    for (const incident of incidents) {
      const absPath = this.uriToAbsolute(incident.uri, workspaceRoot);
      if (absPath) {
        uniquePaths.add(absPath);
      }
    }

    const results = await Promise.allSettled(
      Array.from(uniquePaths).map(async (absPath) => {
        if (!this.originalContentCache.has(absPath)) {
          const content = await fs.readFile(absPath, "utf-8");
          this.originalContentCache.set(absPath, content);
        }
      }),
    );

    const cached = results.filter((r) => r.status === "fulfilled").length;
    this.logger.info("Pre-cached incident file contents", {
      total: uniquePaths.size,
      cached,
    });

    const existing = new Map<string, string>();
    for (const [absPath, baseline] of this.originalContentCache) {
      if (baseline !== null) {
        existing.set(absPath, baseline);
      }
    }
    return existing;
  }

  /**
   * Cache a file's original content before a write tool executes.
   * Called from the toolCall, toolCallUpdate and permissionRequest handlers
   * with the tool arguments and any ACP `locations` paths. A file that does
   * not exist yet is tracked with a missing baseline so the scan reports its
   * creation. Already-tracked files keep their first baseline.
   *
   * `afterWrite` marks a sighting from a *completed* tool update: the write
   * has already happened, so the disk content cannot be the baseline. Such a
   * file, if not tracked yet, takes its baseline from git HEAD, or counts as
   * new when git has no copy.
   */
  cacheFileBeforeWrite(
    toolName: string,
    args: Record<string, unknown>,
    workspaceRoot: string,
    locations?: readonly string[],
    options: { afterWrite?: boolean } = {},
  ): void {
    const name = toolName?.toLowerCase() ?? "";
    const isFileModifying =
      name.includes("write") ||
      name.includes("save") ||
      name.includes("edit") ||
      name.includes("text_editor") ||
      name.includes("create") ||
      name.includes("replace") ||
      name.includes("patch");

    if (!isFileModifying) {
      return;
    }

    // text_editor "view" reads only. "undo_edit" is a write: Goose restores
    // the previous contents with a plain write, so it is tracked like one.
    if (args.command === "view") {
      return;
    }

    const targets = new Set<string>();
    const fromArgs = getToolFilePath(args);
    if (fromArgs) {
      targets.add(fromArgs);
    }
    for (const location of locations ?? []) {
      if (location) {
        targets.add(location);
      }
    }

    for (const filePath of targets) {
      this.trackFile(
        path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath),
        workspaceRoot,
        options.afterWrite === true,
      );
    }
  }

  private trackFile(absPath: string, workspaceRoot: string, afterWrite: boolean): void {
    if (this.originalContentCache.has(absPath) || this.inflightReads.has(absPath)) {
      return;
    }

    const root = workspaceRoot.startsWith("file://") ? fileURLToPath(workspaceRoot) : workspaceRoot;
    const readBaseline: Promise<Baseline> = afterWrite
      ? this.readFromGit(absPath, root).then((content): Baseline => content ?? null)
      : fs.readFile(absPath, "utf-8").then(
          (content): Baseline => content,
          (): Baseline => null, // file does not exist yet — track its creation
        );
    const readPromise = readBaseline
      .then((baseline) => {
        if (!this.originalContentCache.has(absPath)) {
          this.originalContentCache.set(absPath, baseline);
          this.logger.debug("Cached baseline for tool-targeted file", {
            path: absPath,
            exists: baseline !== null,
          });
        }
      })
      .finally(() => {
        this.inflightReads.delete(absPath);
      });

    this.inflightReads.set(absPath, readPromise);
  }

  /**
   * Scan all tracked files for changes since they were last routed.
   * Works regardless of whether permission requests or tool arguments
   * were available -- checks every file with a baseline.
   * Uses a promise-based mutex to prevent concurrent scans.
   */
  async resolvePendingFileChanges(): Promise<TrackedFileChange[]> {
    // If a scan is already in progress, return the existing promise
    if (this.scanPromise) {
      return this.scanPromise;
    }

    this.scanPromise = this.doScan();
    try {
      return await this.scanPromise;
    } finally {
      this.scanPromise = null;
    }
  }

  private async doScan(): Promise<TrackedFileChange[]> {
    // Wait for any inflight reads to complete before comparing
    if (this.inflightReads.size > 0) {
      await Promise.allSettled(this.inflightReads.values());
    }
    return this.collectChanges();
  }

  /**
   * Compare every tracked file with the content that was last routed (or its
   * baseline if never routed) and mark the returned changes as routed.
   */
  private async collectChanges(): Promise<TrackedFileChange[]> {
    const changes: TrackedFileChange[] = [];

    for (const [absPath, baseline] of this.originalContentCache) {
      let currentContent: string;
      try {
        currentContent = await fs.readFile(absPath, "utf-8");
      } catch {
        // Still missing, or deleted — deletions are not reported.
        continue;
      }

      const previous = this.lastRoutedContent.get(absPath) ?? baseline;
      if (currentContent === previous) {
        continue;
      }

      this.lastRoutedContent.set(absPath, currentContent);
      changes.push({
        path: absPath,
        content: currentContent,
        // "" marks a newly created file for the router (isNew).
        originalContent: baseline ?? "",
      });
    }

    return changes;
  }

  /**
   * Get the pre-cached original content for a file. Falls back to git
   * if the file wasn't pre-cached (e.g., the agent modified a file outside
   * the incident scope like pom.xml). This ensures we always have the
   * real original content for diffing, not the already-modified disk content.
   * Returns undefined for files that did not exist before the run.
   */
  async getOriginalContent(absPath: string, workspaceRoot?: string): Promise<string | undefined> {
    // Normalize absPath — it may arrive as a file: or file:// URI
    if (absPath.startsWith("file://")) {
      absPath = fileURLToPath(absPath);
    } else if (absPath.startsWith("file:")) {
      absPath = absPath.slice("file:".length);
    }

    const cached = this.originalContentCache.get(absPath);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    // Normalize workspaceRoot — it may arrive as a file:// URI
    let normalizedRoot = workspaceRoot;
    if (normalizedRoot?.startsWith("file://")) {
      normalizedRoot = fileURLToPath(normalizedRoot);
    } else if (normalizedRoot?.startsWith("file:")) {
      normalizedRoot = normalizedRoot.slice("file:".length);
    }

    // Fall back to git for files not in the cache
    if (normalizedRoot) {
      const gitContent = await this.readFromGit(absPath, normalizedRoot);
      if (gitContent !== undefined) {
        this.originalContentCache.set(absPath, gitContent);
        this.logger.info("Recovered original content from git", { path: absPath });
        return gitContent;
      }
      this.logger.warn("Git fallback failed for file", {
        path: absPath,
        workspaceRoot: normalizedRoot,
        relativePath: path.relative(normalizedRoot, absPath),
      });
    }

    return undefined;
  }

  /**
   * Read file content from git HEAD. Returns undefined if the file
   * isn't tracked or git isn't available.
   */
  private readFromGit(absPath: string, workspaceRoot: string): Promise<string | undefined> {
    const relativePath = path.relative(workspaceRoot, absPath);
    if (relativePath.startsWith("..")) {
      return Promise.resolve(undefined);
    }

    return new Promise((resolve) => {
      execFile(
        "git",
        ["show", `HEAD:${relativePath}`],
        { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024, timeout: 5000 },
        (error, stdout) => {
          if (error) {
            resolve(undefined);
          } else {
            resolve(stdout);
          }
        },
      );
    });
  }

  /**
   * Post-completion scan: compare every tracked file with current disk
   * state. Returns (and marks as routed) changes not already routed.
   */
  async scanForMissedChanges(): Promise<TrackedFileChange[]> {
    if (this.inflightReads.size > 0) {
      await Promise.allSettled(this.inflightReads.values());
    }
    const missedChanges = await this.collectChanges();

    if (missedChanges.length > 0) {
      this.logger.info(`Post-scan found ${missedChanges.length} additional file change(s)`);
    } else {
      this.logger.info(
        `Post-scan: no missed changes (${this.originalContentCache.size} tracked, ${this.lastRoutedContent.size} routed)`,
      );
    }

    return missedChanges;
  }

  /**
   * Register the routing work that follows a scan so `whenIdle()` can wait
   * for it. Returns the same promise for chaining.
   */
  trackRouting<T>(work: Promise<T>): Promise<T> {
    const tracked: Promise<unknown> = work.then(
      () => this.pendingRouting.delete(tracked),
      () => this.pendingRouting.delete(tracked),
    );
    this.pendingRouting.add(tracked);
    return work;
  }

  /**
   * A promise that resolves once every baseline read, scan and registered
   * routing has finished — or `undefined` when nothing is pending, so a
   * caller can stay synchronous in the common case. Used before `clear()`
   * so a turn boundary never discards the previous turn's late work.
   */
  whenIdle(): Promise<void> | undefined {
    if (this.inflightReads.size === 0 && !this.scanPromise && this.pendingRouting.size === 0) {
      return undefined;
    }
    return (async () => {
      while (this.inflightReads.size > 0 || this.scanPromise || this.pendingRouting.size > 0) {
        await Promise.allSettled([
          ...this.inflightReads.values(),
          ...(this.scanPromise ? [this.scanPromise] : []),
          ...this.pendingRouting,
        ]);
      }
    })();
  }

  /** Reset state between iterations / messages. */
  clear(): void {
    this.originalContentCache.clear();
    this.lastRoutedContent.clear();
    this.scanPromise = null;
  }

  private uriToAbsolute(uri: string, workspaceRoot: string): string | undefined {
    try {
      if (uri.startsWith("file://")) {
        return fileURLToPath(uri);
      }
      if (path.isAbsolute(uri)) {
        return uri;
      }
      return path.join(workspaceRoot, uri);
    } catch {
      return undefined;
    }
  }
}
