/**
 * AgentFileTracker: Tracks file state before/during Goose execution
 * to detect modifications made by the Developer extension's text_editor.
 *
 * Original file content is cached from two sources:
 * - cacheIncidentFiles: pre-caches all files referenced by analysis incidents
 * - cacheFileBeforeWrite: caches files targeted by permission requests
 *
 * On every successful tool completion, resolvePendingFileChanges scans all
 * cached files for changes and routes them to batch review immediately.
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

export class AgentFileTracker {
  private readonly originalContentCache = new Map<string, string>();
  private readonly routedFiles = new Set<string>();
  private readonly pendingToolFiles = new Map<string, string>();
  private readonly inflightReads = new Map<string, Promise<void>>();
  private readonly logger: winston.Logger;
  private scanPromise: Promise<TrackedFileChange[]> | null = null;

  constructor(logger: winston.Logger) {
    this.logger = logger.child({ component: "AgentFileTracker" });
  }

  /**
   * Pre-read files referenced by analysis incidents so we have the
   * original content before Goose modifies them on disk.
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

    return new Map(this.originalContentCache);
  }

  /**
   * Cache a file's original content before a write tool executes.
   * Called from the permissionRequest handler with tool arguments.
   */
  cacheFileBeforeWrite(
    toolName: string,
    args: Record<string, unknown>,
    workspaceRoot: string,
    callId?: string,
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

    // text_editor "view" and "undo_edit" don't produce new content
    const command = args.command as string | undefined;
    if (command === "view" || command === "undo_edit") {
      return;
    }

    const filePath = (args.path ?? args.file_path ?? args.filename) as string | undefined;
    if (!filePath) {
      return;
    }

    const absPath = path.isAbsolute(filePath) ? filePath : path.join(workspaceRoot, filePath);

    if (callId) {
      this.pendingToolFiles.set(callId, absPath);
    }

    if (this.originalContentCache.has(absPath) || this.inflightReads.has(absPath)) {
      return;
    }

    const readPromise = fs.readFile(absPath, "utf-8")
      .then((content) => {
        if (!this.originalContentCache.has(absPath)) {
          this.originalContentCache.set(absPath, content);
          this.logger.debug("Cached original for tool-targeted file", { path: absPath });
        }
      })
      .catch(() => {
        // File may not exist yet (new file) — that's fine
      })
      .finally(() => {
        this.inflightReads.delete(absPath);
      });

    this.inflightReads.set(absPath, readPromise);
  }

  /**
   * Scan all cached files for changes that haven't been routed yet.
   * Works regardless of whether permission requests or tool arguments
   * were available -- checks every file in the original content cache.
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

    const changes: TrackedFileChange[] = [];

    for (const [absPath, originalContent] of this.originalContentCache) {
      if (this.routedFiles.has(absPath)) {
        continue;
      }

      let currentContent: string;
      try {
        currentContent = await fs.readFile(absPath, "utf-8");
      } catch {
        continue;
      }

      if (currentContent === originalContent) {
        continue;
      }

      this.routedFiles.add(absPath);
      changes.push({ path: absPath, content: currentContent, originalContent });
    }

    return changes;
  }

  /** Mark a file as already routed to batch review. */
  markAsRouted(absPath: string): void {
    if (absPath.startsWith("file://")) {
      absPath = fileURLToPath(absPath);
    } else if (absPath.startsWith("file:")) {
      absPath = absPath.slice("file:".length);
    }
    this.routedFiles.add(absPath);
  }

  /**
   * Get the pre-cached original content for a file. Falls back to git
   * if the file wasn't pre-cached (e.g., Goose modified a file outside
   * the incident scope like pom.xml). This ensures we always have the
   * real original content for diffing, not the already-modified disk content.
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
      return cached;
    }

    // Normalize workspaceRoot — it may arrive as a file:// URI
    let normalizedRoot = workspaceRoot;
    if (normalizedRoot?.startsWith("file://")) {
      normalizedRoot = new URL(normalizedRoot).pathname;
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
   * Post-completion scan: compare every cached original with current disk
   * state. Returns file changes not already routed to batch review.
   */
  async scanForMissedChanges(): Promise<TrackedFileChange[]> {
    const missedChanges: TrackedFileChange[] = [];

    for (const [absPath, originalContent] of this.originalContentCache) {
      if (this.routedFiles.has(absPath)) {
        continue;
      }

      let currentContent: string;
      try {
        currentContent = await fs.readFile(absPath, "utf-8");
      } catch {
        continue;
      }

      if (currentContent === originalContent) {
        continue;
      }

      missedChanges.push({
        path: absPath,
        content: currentContent,
        originalContent,
      });
    }

    if (missedChanges.length > 0) {
      this.logger.info(`Post-scan found ${missedChanges.length} additional file change(s)`);
    } else {
      this.logger.info(
        `Post-scan: no missed changes (${this.originalContentCache.size} cached, ${this.routedFiles.size} already routed)`,
      );
    }

    return missedChanges;
  }

  /** Reset state between iterations / messages. */
  clear(): void {
    this.originalContentCache.clear();
    this.routedFiles.clear();
    this.pendingToolFiles.clear();
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
