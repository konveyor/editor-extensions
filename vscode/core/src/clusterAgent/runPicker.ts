/**
 * Picking one of the open application's cluster runs, shared by the review
 * and check-out commands.
 */
import * as vscode from "vscode";
import type { HubContext } from "./hubContext";
import { runsForApplication, type RunSummary } from "./runSelection";

/**
 * The run named `preselected`, or the user's pick from the application's
 * workflow runs and standalone agent runs. Undefined (after saying why) if
 * there is nothing to pick or the user cancels.
 */
export async function pickApplicationRun(
  hub: HubContext,
  title: string,
  preselected?: string,
): Promise<RunSummary | undefined> {
  const [workflowRuns, agentRuns] = await Promise.all([
    hub.api.listWorkflowRuns().catch(() => []),
    hub.api.listRuns(),
  ]);
  const runs = runsForApplication(hub.application.id, workflowRuns, agentRuns);
  if (preselected) {
    const run = runs.find((r) => r.name === preselected);
    if (!run) {
      vscode.window.showWarningMessage(`Run ${preselected} was not found on the Hub.`);
    }
    return run;
  }
  if (runs.length === 0) {
    vscode.window.showInformationMessage(`No cluster runs found for ${hub.application.name}.`);
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    runs.map((run) => ({
      label: run.name,
      description: `${run.kind === "workflow" ? "workflow" : "agent"} ${run.ref} · ${run.phase ?? "Pending"}`,
      detail: run.branch ? `Branch ${run.branch}` : "No target branch",
      run,
    })),
    { title, ignoreFocusOut: true },
  );
  return pick?.run;
}
