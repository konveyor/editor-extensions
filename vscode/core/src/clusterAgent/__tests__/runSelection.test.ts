import expect from "expect";
import type { AgentRun, AgentWorkflowRun } from "../contract";
import {
  changedOnBothSides,
  consoleUrl,
  reviewablePaths,
  runsForApplication,
  targetBranch,
  workspaceRelative,
} from "../runSelection";

const env = (app: string, branch: string) => [
  { name: "APP_ID", value: app },
  { name: "TARGET_BRANCH", value: branch },
];

const workflowRun = (name: string, app: string, created: string): AgentWorkflowRun => ({
  metadata: { name, labels: { "konveyor.io/application": app }, creationTimestamp: created },
  spec: { workflowRef: "java-ee-to-quarkus", env: env(app, `konveyor/${name}`) },
  status: { phase: "Succeeded" },
});

const agentRun = (name: string, app: string, created: string, stageOf?: string): AgentRun => ({
  metadata: {
    name,
    creationTimestamp: created,
    labels: {
      "konveyor.io/application": app,
      ...(stageOf ? { "konveyor.io/agentworkflowrun": stageOf } : {}),
    },
  },
  spec: { agentRef: "migration-plan-agent", env: env(app, `konveyor/${name}`) },
  status: { phase: "Failed" },
});

describe("runsForApplication", () => {
  it("lists the application's workflow and standalone runs, newest first", () => {
    const runs = runsForApplication(
      1,
      [
        workflowRun("wf-old", "1", "2026-10-16T00:00:00Z"),
        workflowRun("wf-other", "2", "2026-10-21T00:00:00Z"),
      ],
      [
        agentRun("solo", "1", "2026-10-20T00:00:00Z"),
        agentRun("wf-old-plan", "1", "2026-10-16T00:00:01Z", "wf-old"),
      ],
    );
    expect(runs.map((r) => [r.kind, r.name, r.branch])).toEqual([
      ["agent", "solo", "konveyor/solo"],
      ["workflow", "wf-old", "konveyor/wf-old"],
    ]);
  });

  it("matches by APP_ID when the label is missing", () => {
    const r = workflowRun("wf", "3", "2026-10-21T00:00:00Z");
    r.metadata.labels = {};
    expect(runsForApplication(3, [r], []).map((s) => s.name)).toEqual(["wf"]);
  });
});

describe("helpers", () => {
  it("reads the target branch", () => {
    expect(targetBranch(env("1", "konveyor/x"))).toBe("konveyor/x");
    expect(targetBranch(undefined)).toBeUndefined();
  });

  it("links to the run's console page", () => {
    expect(consoleUrl("http://localhost:18080/", { kind: "workflow", name: "ide-1" })).toBe(
      "http://localhost:18080/workflow-runs/ide-1",
    );
    expect(consoleUrl("https://mta.example", { kind: "agent", name: "ide-2" })).toBe(
      "https://mta.example/agent-runs/ide-2",
    );
  });

  it("keeps only changes inside a workspace that is a repo subfolder", () => {
    const paths = ["README.md", "app/src/A.java", "app/pom.xml", "other/B.java"];
    expect(workspaceRelative(paths, "")).toEqual(paths);
    expect(workspaceRelative(paths, "app")).toEqual(["src/A.java", "pom.xml"]);
  });
});

describe("reviewablePaths", () => {
  it("leaves out the harness's .konveyor notes but keeps the plan", () => {
    expect(
      reviewablePaths([".konveyor/handoff.md", "docs/plan.md", "pom.xml", ".konveyorrc"]),
    ).toEqual(["docs/plan.md", "pom.xml", ".konveyorrc"]);
  });
});

describe("changedOnBothSides", () => {
  it("flags a file both the developer and the run changed differently", () => {
    expect(changedOnBothSides("v0", "mine", "theirs")).toBe(true);
  });

  it("does not flag one-sided or identical changes", () => {
    expect(changedOnBothSides("v0", "v0", "theirs")).toBe(false); // only the run changed it
    expect(changedOnBothSides("v0", "mine", "v0")).toBe(false); // only the developer did
    expect(changedOnBothSides("v0", "same", "same")).toBe(false); // both made the same change
  });
});
