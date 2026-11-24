/**
 * "Check Out Cluster Run Branch": continue a migration on the run's own
 * branch (epic #1511).
 *
 * Checks out the run's target branch (tracking the remote one, with its
 * commits), syncs the application's analysis profiles from the Hub and
 * activates one, and starts analysis. What analysis still reports is the
 * remaining work, for Get Solution or the agent; pushing keeps the
 * migration on the run's branch. Use "Review Cluster Run Results" instead to
 * adopt part of a run into another branch.
 */
import * as vscode from "vscode";
import type { Logger } from "winston";
import { ChatMessageType, type AnalysisProfile } from "@editor-extensions/shared";
import type { ExtensionState } from "../extensionState";
import { executeExtensionCommand } from "../commands";
import { getGitRepository, preferredRemote, uncommittedChangeCount } from "../utilities/git";
import { getAllProfiles, setActiveProfileId } from "../utilities/profiles/profileService";
import { resolveHubContext } from "./hubContext";
import { pickApplicationRun } from "./runPicker";
import type { RunSummary } from "./runSelection";

export async function checkoutClusterRun(
  state: ExtensionState,
  logger: Logger,
  preselectedRun?: string,
): Promise<void> {
  const log = logger.child({ component: "ClusterRunCheckout" });
  try {
    if (state.data.isFetchingSolution || state.data.isAnalyzing) {
      vscode.window.showWarningMessage(
        "Wait for the current analysis or solution to finish first.",
      );
      return;
    }
    const hub = await resolveHubContext(state, log);
    if (!hub) {
      return;
    }
    const run = await pickApplicationRun(
      hub,
      `Check out a cluster run's branch for ${hub.application.name}`,
      preselectedRun,
    );
    if (!run) {
      return;
    }
    if (!run.branch) {
      vscode.window.showWarningMessage(`Run ${run.name} does not name a target branch.`);
      return;
    }
    const branch = run.branch;

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
    const dirty = uncommittedChangeCount(repo);
    if (dirty > 0) {
      const choice = await vscode.window.showWarningMessage(
        `You have ${dirty} uncommitted change${dirty === 1 ? "" : "s"}. Commit or stash them before checking out ${branch}, ` +
          "or review the run's changes on your current branch instead.",
        "Review changes instead",
      );
      if (choice === "Review changes instead") {
        await executeExtensionCommand("reviewClusterRun", run.name);
      }
      return;
    }

    const pulled = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Checking out ${branch}` },
      async (progress) => {
        progress.report({ message: `fetching from ${remote}` });
        try {
          await repo.fetch(remote, branch);
        } catch (err) {
          throw new Error(
            `Could not fetch ${branch} from ${remote}. The run may not have pushed yet. (${errorText(err)})`,
          );
        }
        const upstream = `${remote}/${branch}`;
        const exists = await repo.getBranch(branch).then(
          () => true,
          () => false,
        );
        if (!exists) {
          await repo.createBranch(branch, true, upstream);
          await repo.setBranchUpstream(branch, upstream).catch(() => undefined);
          return true;
        }
        await repo.checkout(branch);
        // Bring an existing local copy up to the run's latest push.
        return repo.pull().then(
          () => true,
          (err: unknown) => {
            log.warn("Pull after checkout failed", { branch, error: errorText(err) });
            return false;
          },
        );
      },
    );
    log.info("Checked out cluster run branch", { run: run.name, branch, pulled });

    const profile = await activateHubProfile(state, hub.application.name);
    if (profile === "cancelled") {
      note(state, run, branch, undefined, false, pulled);
      return;
    }
    const analysisStarted = await startAnalysis(state);
    note(state, run, branch, profile, analysisStarted, pulled);
    void executeExtensionCommand("openChat");
    vscode.window.showInformationMessage(
      `On ${branch} from ${run.name}.` +
        (analysisStarted
          ? " Analysis is running; what it reports is what is left to migrate."
          : " Start the analyzer and run analysis to see what is left.") +
        (pulled
          ? ""
          : " Your local copy of the branch could not be updated; pull it before continuing."),
    );
  } catch (err) {
    const message = errorText(err);
    log.error("Checking out a cluster run failed", { error: message });
    vscode.window.showErrorMessage(`Checking out the cluster run failed: ${message}`);
  }
}

/**
 * Sync the application's analysis profiles from the Hub and activate one,
 * so analysis uses the targets the Hub assigns to this application (the
 * ones its own analysis, and so the run's plan, would have used).
 */
async function activateHubProfile(
  state: ExtensionState,
  applicationName: string,
): Promise<AnalysisProfile | undefined | "cancelled"> {
  await executeExtensionCommand("syncHubProfiles", true);
  const profiles = await getAllProfiles(state.extensionContext);
  const hubProfiles = profiles.filter((p) => p.source === "hub");
  if (hubProfiles.length === 0) {
    const active = profiles.find((p) => p.id === state.data.activeProfileId);
    const choice = await vscode.window.showWarningMessage(
      `The Hub has no analysis profile for ${applicationName} (it comes from the application's archetype). ` +
        `Analysis would use ${active ? `your profile "${active.name}"` : "your current profile"}, ` +
        "whose targets may not match the ones the run's plan used.",
      "Analyze anyway",
      "Skip analysis",
    );
    return choice === "Analyze anyway" ? active : "cancelled";
  }
  let chosen = hubProfiles[0];
  if (hubProfiles.length > 1) {
    const pick = await vscode.window.showQuickPick(
      hubProfiles.map((p) => ({ label: p.name, profile: p })),
      { title: `Analysis profile for ${applicationName}`, ignoreFocusOut: true },
    );
    if (!pick) {
      return "cancelled";
    }
    chosen = pick.profile;
  }
  state.mutate((draft) => {
    draft.profiles = profiles;
  });
  await setActiveProfileId(chosen.id, state);
  return chosen;
}

/** Start the analyzer if needed, then run analysis. True if analysis started. */
async function startAnalysis(state: ExtensionState): Promise<boolean> {
  const analyzer = state.analyzerClient;
  if (!analyzer) {
    return false;
  }
  if (analyzer.serverState !== "running") {
    await executeExtensionCommand("startServer");
  }
  if (analyzer.serverState !== "running" || !analyzer.canAnalyze()) {
    return false;
  }
  await executeExtensionCommand("runAnalysis");
  return true;
}

function note(
  state: ExtensionState,
  run: RunSummary,
  branch: string,
  profile: AnalysisProfile | undefined,
  analysisStarted: boolean,
  pulled: boolean,
): void {
  const parts = [
    `**Checked out \`${branch}\`** from cluster run \`${run.name}\` (${run.ref}, ${run.phase ?? "Pending"}).`,
  ];
  if (!pulled) {
    parts.push(
      "Your local copy of the branch could not be updated from the remote; pull it before continuing.",
    );
  }
  if (analysisStarted) {
    parts.push(
      `Analysis started${profile ? ` with the ${profile.source === "hub" ? "Hub" : "local"} profile "${profile.name}"` : ""}. ` +
        "What it reports is what is left: use Get Solution, or ask the agent, and push to keep the migration on this branch.",
    );
  } else {
    parts.push("Analysis did not start; start the analyzer and run it to see what is left.");
  }
  state.mutate((draft) => {
    draft.chatMessages.push({
      kind: ChatMessageType.String,
      messageToken: `cluster-checkout-${run.name}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      value: { message: parts.join(" ") },
    });
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
