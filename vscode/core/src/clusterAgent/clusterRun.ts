/**
 * "Start Migration on Cluster": start an AgentWorkflowRun (or a single
 * AgentRun) for the open application through the Hub (epic #1511).
 *
 * The IDE hands off here. Watching and supervising the run (its stream,
 * approvals, questions) happens in the Konveyor console; the IDE comes back
 * in at the end with "Review Cluster Run Results", which loads the run's
 * branch into the batch review.
 */
import * as vscode from "vscode";
import type { Logger } from "winston";
import type { ExtensionState } from "../extensionState";
import { executeExtensionCommand } from "../commands";
import { HubAgentApiError } from "./hubAgentApi";
import { resolveHubContext } from "./hubContext";
import { consoleUrl } from "./runSelection";
import {
  DEFAULT_WORKFLOW,
  MANAGED_LABEL,
  type AgentResource,
  type AgentWorkflow,
  type ExecutionMode,
} from "./contract";

type RunTarget =
  | { kind: "workflow"; workflow: AgentWorkflow }
  | { kind: "agent"; agent: AgentResource };

export async function startClusterRun(state: ExtensionState, logger: Logger): Promise<void> {
  const log = logger.child({ component: "ClusterRun" });
  try {
    const hub = await resolveHubContext(state, log);
    if (!hub) {
      return;
    }
    const { api, application } = hub;

    // Workflows have their own scope (agentic.workflows); without it, still
    // offer single agents rather than failing outright.
    const [workflows, agents] = await Promise.all([
      api.listWorkflows().catch((err: unknown) => {
        if (err instanceof HubAgentApiError && (err.status === 403 || err.status === 404)) {
          log.warn("Cannot list workflows; offering single agents only", { error: err.message });
          return [] as AgentWorkflow[];
        }
        throw err;
      }),
      api.listAgents(),
    ]);
    const target = await pickTarget(workflows, agents);
    if (!target) {
      return;
    }
    const mode = target.kind === "agent" ? await pickMode() : undefined;
    if (target.kind === "agent" && !mode) {
      return;
    }
    const branchInput = await vscode.window.showInputBox({
      title: "Branch the run pushes its changes to",
      value: defaultTargetBranch(),
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : "A branch name is required"),
    });
    if (!branchInput) {
      return;
    }
    const branch = branchInput.trim();

    let runName: string;
    let kind: "workflow" | "agent";
    if (target.kind === "workflow") {
      const run = await api.createWorkflowRun({
        workflowRef: target.workflow.metadata.name!,
        applicationId: application.id,
        targetBranch: branch,
      });
      runName = run.metadata.name!;
      kind = "workflow";
    } else {
      const run = await api.createRun({
        agentRef: target.agent.metadata.name!,
        applicationId: application.id,
        targetBranch: branch,
        mode: mode!,
        // Questions are answered in the console (agentic-controller ADR 0017).
        askUser: mode === "approve",
      });
      runName = run.metadata.name!;
      kind = "agent";
    }
    log.info("Cluster run started", { kind, runName, branch, application: application.name });

    const url = consoleUrl(hub.hubUrl, { kind, name: runName });
    const choice = await vscode.window.showInformationMessage(
      `Started ${kind === "workflow" ? "workflow run" : "run"} ${runName} for ${application.name}. ` +
        `Follow it in the Konveyor console; when it finishes, check out ${branch} or review its changes here.` +
        (mode === "approve" ? " Its approvals and questions are answered in the console." : ""),
      "Open in console",
      "Check out branch",
      "Review changes",
    );
    if (choice === "Open in console") {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } else if (choice === "Check out branch") {
      await executeExtensionCommand("checkoutClusterRun", runName);
    } else if (choice === "Review changes") {
      await executeExtensionCommand("reviewClusterRun", runName);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Starting a cluster run failed", { error: message });
    vscode.window.showErrorMessage(`Starting the cluster run failed: ${message}`);
  }
}

type TargetItem = vscode.QuickPickItem & { target?: RunTarget };

/**
 * Workflows first (MTA's java-ee-to-quarkus at the top), then single agents.
 * A stage agent on its own usually lacks what earlier stages produce (the
 * execute agent needs the plan stage's docs/plan.md), so workflows lead.
 */
async function pickTarget(
  workflows: AgentWorkflow[],
  agents: AgentResource[],
): Promise<RunTarget | undefined> {
  if (workflows.length === 0 && agents.length === 0) {
    vscode.window.showWarningMessage("The Hub has no workflows or agents defined.");
    return undefined;
  }
  const byName = (a: { metadata: { name?: string } }, b: { metadata: { name?: string } }) =>
    (a.metadata.name ?? "").localeCompare(b.metadata.name ?? "");
  const sortedWorkflows = [...workflows].sort(
    (a, b) =>
      Number(b.metadata.name === DEFAULT_WORKFLOW) - Number(a.metadata.name === DEFAULT_WORKFLOW) ||
      byName(a, b),
  );
  const sortedAgents = [...agents].sort(
    (a, b) =>
      Number(b.metadata.labels?.[MANAGED_LABEL] === "true") -
        Number(a.metadata.labels?.[MANAGED_LABEL] === "true") || byName(a, b),
  );
  const items: TargetItem[] = [];
  if (sortedWorkflows.length > 0) {
    items.push({ label: "Workflows", kind: vscode.QuickPickItemKind.Separator });
    for (const workflow of sortedWorkflows) {
      items.push({
        label: workflow.metadata.name ?? "(unnamed)",
        description: (workflow.spec.stages ?? []).map((s) => s.name).join(" → "),
        detail: workflow.spec.guide?.split("\n")[0],
        target: { kind: "workflow", workflow },
      });
    }
  }
  if (sortedAgents.length > 0) {
    items.push({ label: "Single agents", kind: vscode.QuickPickItemKind.Separator });
    for (const agent of sortedAgents) {
      items.push({
        label: agent.metadata.name ?? "(unnamed)",
        description: agent.metadata.labels?.[MANAGED_LABEL] === "true" ? "Konveyor" : undefined,
        detail: agent.spec.image,
        target: { kind: "agent", agent },
      });
    }
  }
  const pick = await vscode.window.showQuickPick(items, {
    title: "Start on the cluster",
    placeHolder: "A workflow runs its stages in order; a single agent runs on its own",
    ignoreFocusOut: true,
  });
  return pick?.target;
}

async function pickMode(): Promise<ExecutionMode | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "Ask before changes",
        detail:
          "Each file edit and command waits for approval in the Konveyor console, about 3 minutes by default before the run fails.",
        mode: "approve" as const,
      },
      {
        label: "Auto-approve",
        detail: "The agent works unattended; review its branch afterwards.",
        mode: "auto" as const,
      },
    ],
    { title: "How should the agent work?", ignoreFocusOut: true },
  );
  return pick?.mode;
}

function defaultTargetBranch(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `konveyor/migration-${stamp}`;
}
