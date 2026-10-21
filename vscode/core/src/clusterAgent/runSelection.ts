/**
 * Choosing which cluster runs belong to the open application, and how to
 * describe and link to them. Pure, so it is unit tested.
 */
import {
  APPLICATION_LABEL,
  WORKFLOW_RUN_LABEL,
  type AgentRun,
  type AgentRunPhase,
  type AgentWorkflowRun,
} from "./contract";

export interface RunSummary {
  kind: "workflow" | "agent";
  name: string;
  /** The workflow or agent that ran. */
  ref: string;
  phase?: AgentRunPhase;
  /** Branch the run pushes to (TARGET_BRANCH). */
  branch?: string;
  created?: string;
}

type Env = Array<{ name: string; value: string }> | undefined;

export function targetBranch(env: Env): string | undefined {
  return env?.find((e) => e.name === "TARGET_BRANCH")?.value;
}

function belongsTo(applicationId: number, labels: Record<string, string> | undefined, env: Env) {
  const id = String(applicationId);
  return labels?.[APPLICATION_LABEL] === id || env?.find((e) => e.name === "APP_ID")?.value === id;
}

/**
 * The application's workflow runs and standalone agent runs, newest first.
 * The AgentRuns a workflow run creates for its stages are left out: their
 * work is the workflow run's.
 */
export function runsForApplication(
  applicationId: number,
  workflowRuns: AgentWorkflowRun[],
  agentRuns: AgentRun[],
): RunSummary[] {
  const summaries: RunSummary[] = [
    ...workflowRuns
      .filter((r) => belongsTo(applicationId, r.metadata.labels, r.spec.env))
      .map((r) => ({
        kind: "workflow" as const,
        name: r.metadata.name ?? "",
        ref: r.spec.workflowRef,
        phase: r.status?.phase,
        branch: targetBranch(r.spec.env),
        created: r.metadata.creationTimestamp,
      })),
    ...agentRuns
      .filter((r) => !r.metadata.labels?.[WORKFLOW_RUN_LABEL])
      .filter((r) => belongsTo(applicationId, r.metadata.labels, r.spec.env))
      .map((r) => ({
        kind: "agent" as const,
        name: r.metadata.name ?? "",
        ref: r.spec.agentRef,
        phase: r.status?.phase,
        branch: targetBranch(r.spec.env),
        created: r.metadata.creationTimestamp,
      })),
  ];
  return summaries
    .filter((s) => s.name)
    .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));
}

/**
 * The run's page in the Konveyor console (tackle2-ui's /workflow-runs/:name
 * and /agent-runs/:name), served from the same origin as the Hub.
 */
export function consoleUrl(hubBaseUrl: string, run: Pick<RunSummary, "kind" | "name">): string {
  const base = hubBaseUrl.replace(/\/+$/, "");
  const page = run.kind === "workflow" ? "workflow-runs" : "agent-runs";
  return `${base}/${page}/${encodeURIComponent(run.name)}`;
}

/**
 * Leave out the harness's own files: `.konveyor/` holds its notes between
 * stages (handoff.md), not part of the migration. Analysis ignores that
 * directory too.
 */
export function reviewablePaths(workspacePaths: string[]): string[] {
  return workspacePaths.filter((p) => p !== ".konveyor" && !p.startsWith(".konveyor/"));
}

/** Paths of the run's changed files that fall inside the workspace, relative to it. */
export function workspaceRelative(repoRelativePaths: string[], workspaceSubdir: string): string[] {
  const prefix = workspaceSubdir.replace(/^\/+|\/+$/g, "");
  if (!prefix) {
    return repoRelativePaths;
  }
  return repoRelativePaths
    .filter((p) => p === prefix || p.startsWith(`${prefix}/`))
    .map((p) => p.slice(prefix.length + 1))
    .filter(Boolean);
}
