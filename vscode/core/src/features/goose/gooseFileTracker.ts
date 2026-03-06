/**
 * GooseFileTracker: Tracks file state before/during Goose execution
 * to detect modifications that bypass the MCP bridge (i.e., when Goose
 * uses its built-in Developer tools like text_editor instead of calling
 * apply_file_changes through our MCP server).
 *
 * Primary channel: MCP bridge apply_file_changes → onFileChanges callback
 * Fallback: post-completion scan via this tracker
 *
 * Both channels feed into the same pipeline (processModifiedFile → batch review).
 */

import * as fs from "fs/promises";
import * as path from "path";
import { execFile } from "child_process";
import type winston from "winston";

export interface TrackedFileChange {
  path: string;
  content: string;
  originalContent?: string;
}

export class GooseFileTracker {
  private readonly originalContentCache = new Map<string, string>();
  private readonly routedFiles = new Set<string>();
  private readonly pendingToolFiles = new Map<string, string>();
  private readonly logger: winston.Logger;

  constructor(logger: winston.Logger) {
    this.logger = logger.child({ component: "GooseFileTracker" });
  }

  /**
   * Pre-read files referenced by analysis incidents so we have the
   * original content before Goose modifies them on disk.
   */
  async cacheIncidentFiles(
    incidents: ReadonlyArray<{ readonly uri: string }>,
    workspaceRoot: string,
  ): Promise<void> {
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
  }

  /**
   * Cache a single file's content before a write tool executes.
   * Called from the toolCall event listener when we see file-modifying tools.
   * Fire-and-forget — the tool_call event fires before execution, so we
   * usually win the race against the actual write.
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

    if (this.originalContentCache.has(absPath)) {
      return;
    }

    fs.readFile(absPath, "utf-8")
      .then((content) => {
        if (!this.originalContentCache.has(absPath)) {
          this.originalContentCache.set(absPath, content);
          this.logger.debug("Cached original for tool-targeted file", { path: absPath });
        }
      })
      .catch(() => {
        // File may not exist yet (new file) — that's fine
      });
  }

  /**
   * Check all files cached from permission requests for changes.
   * Returns changes for files that were modified and haven't been routed yet.
   */
  async resolvePendingFileChanges(): Promise<TrackedFileChange[]> {
    const changes: TrackedFileChange[] = [];

    for (const absPath of this.pendingToolFiles.values()) {
      if (this.routedFiles.has(absPath)) {
        continue;
      }

      const originalContent = this.originalContentCache.get(absPath);

      let currentContent: string;
      try {
        currentContent = await fs.readFile(absPath, "utf-8");
      } catch {
        continue;
      }

      if (originalContent !== undefined && currentContent === originalContent) {
        continue;
      }

      this.routedFiles.add(absPath);
      changes.push({ path: absPath, content: currentContent, originalContent });
    }

    return changes;
  }

  /**
   * Mark a file as already routed through the MCP bridge onFileChanges
   * pipeline. The post-scan will skip these files to avoid duplicates.
   */
  markAsRouted(absPath: string): void {
    if (absPath.startsWith("file://")) {
      absPath = new URL(absPath).pathname;
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
      absPath = new URL(absPath).pathname;
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
   * state. Returns file changes for files that were modified but NOT
   * already routed through the MCP bridge.
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
      this.logger.info(
        `Post-scan found ${missedChanges.length} file(s) modified outside MCP bridge`,
      );
    } else {
      this.logger.info(
        `Post-scan: no missed changes (${this.originalContentCache.size} cached, ${this.routedFiles.size} routed via MCP)`,
      );
    }

    return missedChanges;
  }

  /** Reset state between iterations / messages. */
  clear(): void {
    this.originalContentCache.clear();
    this.routedFiles.clear();
    this.pendingToolFiles.clear();
  }

  private uriToAbsolute(uri: string, workspaceRoot: string): string | undefined {
    try {
      if (uri.startsWith("file://")) {
        return new URL(uri).pathname;
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
