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
import type winston from "winston";

export interface TrackedFileChange {
  path: string;
  content: string;
  originalContent?: string;
}

export class GooseFileTracker {
  private readonly originalContentCache = new Map<string, string>();
  private readonly routedFiles = new Set<string>();
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
   * Mark a file as already routed through the MCP bridge onFileChanges
   * pipeline. The post-scan will skip these files to avoid duplicates.
   */
  markAsRouted(absPath: string): void {
    this.routedFiles.add(absPath);
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
