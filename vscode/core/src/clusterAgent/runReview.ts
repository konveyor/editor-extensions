/**
 * "Review Cluster Run Results": bring a cluster run's changes into the
 * workspace for review (epic #1511).
 *
 * A run (or each stage of a workflow run) pushes its changes to the run's
 * target branch. This fetches that branch, diffs it against the point where
 * it left the application's branch, and queues every changed file in the
 * existing batch review: Apply / Reject per file, or Review to walk it with
 * the inline diff and CodeLens. Nothing is written to the workspace until a
 * file is applied. The harness pushes incrementally, so a run still in
 * progress can be reviewed too.
 */
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import type { Logger } from "winston";
import { ChatMessageType } from "@editor-extensions/shared";
import type { ExtensionState } from "../extensionState";
import { executeExtensionCommand } from "../commands";
import { getGitRepository, preferredRemote } from "../utilities/git";
import { routeFileChange } from "../features/agent/fileChangeRouter";
import { resolveHubContext } from "./hubContext";
import { pickApplicationRun } from "./runPicker";
import {
  changedOnBothSides,
  consoleUrl,
  reviewablePaths,
  workspaceRelative,
  type RunSummary,
} from "./runSelection";

export async function reviewClusterRun(
  state: ExtensionState,
  logger: Logger,
  preselectedRun?: string,
): Promise<void> {
  const log = logger.child({ component: "ClusterRunReview" });
  try {
    if (state.data.isFetchingSolution) {
      vscode.window.showWarningMessage("Wait for the current solution run to finish first.");
      return;
    }
    const hub = await resolveHubContext(state, log);
    if (!hub) {
      return;
    }
    const { application, repoInfo } = hub;
    const run = await pickApplicationRun(
      hub,
      `Review a cluster run for ${application.name}`,
      preselectedRun,
    );
    if (!run) {
      return;
    }
    if (!run.branch) {
      vscode.window.showWarningMessage(`Run ${run.name} does not name a target branch.`);
      return;
    }

    const repo = getGitRepository(state.data.workspaceRoot);
    if (!repo) {
      vscode.window.showWarningMessage("Could not open the workspace's git repository.");
      return;
    }
    const remote = preferredRemote(repo);
    if (!remote) {
      vscode.window.showWarningMessage("The workspace repository has no remote to fetch from.");
      return;
    }
    const baseBranch = application.repository?.branch || repoInfo.currentBranch;
    const runRef = `${remote}/${run.branch}`;
    const baseRef = `${remote}/${baseBranch}`;

    const loaded = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Loading changes from ${run.name}`,
      },
      async (progress) => {
        progress.report({ message: `fetching ${run.branch}` });
        try {
          await repo.fetch(remote, run.branch);
        } catch (err) {
          throw new Error(
            `Could not fetch ${run.branch} from ${remote}. The run may not have pushed yet. (${errorText(err)})`,
          );
        }
        await repo.fetch(remote, baseBranch).catch(() => undefined);
        const mergeBase =
          (await repo.getMergeBase(baseRef, runRef).catch(() => undefined)) ?? baseRef;
        progress.report({ message: "comparing" });
        const changes = await repo.diffBetween(mergeBase, runRef);

        const repoRoot = repo.rootUri.fsPath;
        const changedPaths = Array.from(
          new Set(
            changes.map((c) => path.relative(repoRoot, c.uri.fsPath).split(path.sep).join("/")),
          ),
        );
        const inWorkspace = reviewablePaths(
          workspaceRelative(changedPaths, repoInfo.workspaceRelativePath),
        );
        const prefix = repoInfo.workspaceRelativePath.replace(/^\/+|\/+$/g, "");

        let queued = 0;
        let unchanged = 0;
        const deleted: string[] = [];
        const bothSides: string[] = [];
        for (const rel of inWorkspace) {
          const repoPath = prefix ? `${prefix}/${rel}` : rel;
          const absPath = path.join(repoRoot, ...repoPath.split("/"));
          let content: string;
          try {
            // The vscode.git API takes the working-tree path and makes it
            // relative to the repository itself.
            content = await repo.show(runRef, absPath);
          } catch {
            deleted.push(rel); // removed on the run's branch
            continue;
          }
          const local = await fs.readFile(absPath, "utf-8").catch(() => "");
          if (local === content) {
            unchanged++;
            continue;
          }
          const base = await repo.show(mergeBase, absPath).catch(() => "");
          if (changedOnBothSides(base, local, content)) {
            bothSides.push(rel);
          }
          // Review against what the developer has now, so applying a file
          // shows exactly what changes in their working tree.
          await routeFileChange(state, absPath, content, local, true);
          queued++;
        }
        return {
          queued,
          unchanged,
          deleted,
          bothSides,
          outside: changedPaths.length - inWorkspace.length,
        };
      },
    );

    log.info("Loaded cluster run changes", { run: run.name, ...loaded });
    noteInChat(state, run, loaded);
    if (loaded.queued > 0) {
      void executeExtensionCommand("openChat");
    }
    const summary =
      loaded.queued > 0
        ? `${loaded.queued} changed file${loaded.queued === 1 ? "" : "s"} from ${run.name} are ready for review in the Migration Assistant.` +
          (loaded.bothSides.length > 0
            ? ` ${loaded.bothSides.length} also changed on your side; applying them replaces your version.`
            : "")
        : `No changes from ${run.name} differ from your working tree.`;
    const choice = await vscode.window.showInformationMessage(summary, "Open in console");
    if (choice === "Open in console") {
      await vscode.env.openExternal(vscode.Uri.parse(consoleUrl(hub.hubUrl, run)));
    }
  } catch (err) {
    const message = errorText(err);
    log.error("Reviewing a cluster run failed", { error: message });
    vscode.window.showErrorMessage(`Reviewing the cluster run failed: ${message}`);
  }
}

function noteInChat(
  state: ExtensionState,
  run: RunSummary,
  loaded: {
    queued: number;
    unchanged: number;
    deleted: string[];
    bothSides: string[];
    outside: number;
  },
): void {
  const parts = [
    `**Changes from cluster run \`${run.name}\`** (${run.ref}, ${run.phase ?? "Pending"}) on \`${run.branch}\`: ` +
      `${loaded.queued} file${loaded.queued === 1 ? "" : "s"} to review below.`,
  ];
  if (loaded.bothSides.length > 0) {
    parts.push(
      `**Changed on your side too:** ${loaded.bothSides.map((f) => `\`${f}\``).join(", ")}. ` +
        "Applying one of these replaces your version; use Review to keep both sets of changes.",
    );
  }
  if (loaded.unchanged > 0) {
    parts.push(`${loaded.unchanged} already match your working tree.`);
  }
  if (loaded.deleted.length > 0) {
    parts.push(
      `Removed on the branch and not applied here: ${loaded.deleted.map((d) => `\`${d}\``).join(", ")}.`,
    );
  }
  if (loaded.outside > 0) {
    parts.push(`${loaded.outside} changed outside this workspace folder.`);
  }
  state.mutate((draft) => {
    draft.chatMessages.push({
      kind: ChatMessageType.String,
      messageToken: `cluster-review-${run.name}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      value: { message: parts.join(" ") },
    });
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
