/**
 * Deciding what to do next while following an AgentWorkflowRun.
 *
 * The controller runs the stages in order, creating one AgentRun per stage
 * and pointing `status.currentStage` at the one running. The IDE attaches to
 * each stage's AgentRun in turn. Pure, so the decision is unit tested.
 */
import {
  isTerminalPhase,
  type AgentRunPhase,
  type AgentWorkflowRun,
  type AgentWorkflowRunStageStatus,
} from "./contract";

export type FollowStep =
  /** Attach to this stage's AgentRun. */
  | { kind: "attach"; stage: AgentWorkflowRunStageStatus; agentRunName: string }
  /** Nothing to attach to yet (stage not started, or its run not created). */
  | { kind: "wait" }
  /** The workflow run is over. */
  | { kind: "done"; phase: AgentRunPhase };

/**
 * @param followed names of the stage AgentRuns already followed (attached,
 *   or reported as missed), so each stage is followed once.
 */
export function nextFollowStep(run: AgentWorkflowRun, followed: ReadonlySet<string>): FollowStep {
  const stages = run.status?.stages ?? [];
  const candidate = (stage: AgentWorkflowRunStageStatus | undefined) =>
    stage?.agentRunName && !followed.has(stage.agentRunName) && !isTerminalPhase(stage.phase)
      ? stage
      : undefined;

  // The current stage first; then any earlier stage still running that we
  // have not followed (a status read can lag the controller by a poll).
  const current = candidate(stages.find((s) => s.name === run.status?.currentStage));
  const next = current ?? stages.map(candidate).find((s) => s !== undefined);
  if (next) {
    return { kind: "attach", stage: next, agentRunName: next.agentRunName! };
  }
  if (isTerminalPhase(run.status?.phase)) {
    return { kind: "done", phase: run.status!.phase! };
  }
  return { kind: "wait" };
}

/**
 * Stages that ended without being followed (they finished between polls, or
 * before the IDE attached), so the transcript can say so instead of
 * silently skipping them.
 */
export function missedStages(
  run: AgentWorkflowRun,
  followed: ReadonlySet<string>,
): AgentWorkflowRunStageStatus[] {
  return (run.status?.stages ?? []).filter(
    (s) => s.agentRunName && !followed.has(s.agentRunName) && isTerminalPhase(s.phase),
  );
}

/** "plan → execute → verify", for the picker and the start note. */
export function describeStages(stageNames: string[]): string {
  return stageNames.join(" → ");
}
