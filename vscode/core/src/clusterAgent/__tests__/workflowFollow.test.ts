import expect from "expect";
import type { AgentRunPhase, AgentWorkflowRun, AgentWorkflowRunStageStatus } from "../contract";
import { describeStages, missedStages, nextFollowStep } from "../workflowFollow";

function run(
  stages: Array<Partial<AgentWorkflowRunStageStatus> & { name: string }>,
  extra: { phase?: AgentRunPhase; currentStage?: string } = {},
): AgentWorkflowRun {
  return {
    metadata: { name: "ide-wf" },
    spec: { workflowRef: "java-ee-to-quarkus" },
    status: {
      phase: extra.phase ?? "Running",
      currentStage: extra.currentStage,
      stages: stages.map((s) => ({ phase: "Pending", ...s })) as AgentWorkflowRunStageStatus[],
    },
  };
}

describe("nextFollowStep", () => {
  it("waits until the current stage has an AgentRun", () => {
    const r = run([{ name: "plan" }, { name: "execute" }, { name: "verify" }], {
      currentStage: "plan",
      phase: "Pending",
    });
    expect(nextFollowStep(r, new Set())).toEqual({ kind: "wait" });
  });

  it("attaches to the current stage's AgentRun", () => {
    const r = run(
      [{ name: "plan", phase: "Running", agentRunName: "wf-plan" }, { name: "execute" }],
      { currentStage: "plan" },
    );
    const step = nextFollowStep(r, new Set());
    expect(step).toMatchObject({ kind: "attach", agentRunName: "wf-plan" });
  });

  it("moves to the next stage once the previous one was followed", () => {
    const r = run(
      [
        { name: "plan", phase: "Succeeded", agentRunName: "wf-plan" },
        { name: "execute", phase: "Running", agentRunName: "wf-execute" },
      ],
      { currentStage: "execute" },
    );
    expect(nextFollowStep(r, new Set(["wf-plan"]))).toMatchObject({
      kind: "attach",
      agentRunName: "wf-execute",
    });
    expect(nextFollowStep(r, new Set(["wf-plan", "wf-execute"]))).toEqual({ kind: "wait" });
  });

  it("finishes when the workflow run is over and nothing is left to follow", () => {
    const r = run(
      [
        { name: "plan", phase: "Succeeded", agentRunName: "wf-plan" },
        { name: "execute", phase: "Failed", agentRunName: "wf-execute" },
      ],
      { currentStage: "execute", phase: "Failed" },
    );
    expect(nextFollowStep(r, new Set(["wf-plan", "wf-execute"]))).toEqual({
      kind: "done",
      phase: "Failed",
    });
  });

  it("follows a still-running stage even if currentStage already moved on", () => {
    const r = run(
      [
        { name: "plan", phase: "Running", agentRunName: "wf-plan" },
        { name: "execute", phase: "Pending" },
      ],
      { currentStage: "execute" },
    );
    expect(nextFollowStep(r, new Set())).toMatchObject({ kind: "attach", agentRunName: "wf-plan" });
  });
});

describe("missedStages", () => {
  it("lists stages that ended before they were followed", () => {
    const r = run(
      [
        { name: "plan", phase: "Succeeded", agentRunName: "wf-plan" },
        { name: "execute", phase: "Running", agentRunName: "wf-execute" },
      ],
      { currentStage: "execute" },
    );
    expect(missedStages(r, new Set()).map((s) => s.name)).toEqual(["plan"]);
    expect(missedStages(r, new Set(["wf-plan"]))).toEqual([]);
  });
});

describe("describeStages", () => {
  it("joins stage names in order", () => {
    expect(describeStages(["plan", "execute", "verify"])).toBe("plan → execute → verify");
  });
});
