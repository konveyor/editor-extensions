/**
 * "Run on cluster": start an AgentWorkflowRun (or a single AgentRun) for the
 * open application through the Hub and follow it in the Migration Assistant
 * chat (epic #1511).
 *
 * The cluster harness drives the agent; the IDE is a viewer. A workflow run
 * (MTA ships java-ee-to-quarkus: plan → execute → verify) is followed stage
 * by stage: the IDE attaches to each stage's AgentRun as the controller
 * advances `currentStage`. The stream goes into the chat transcript,
 * permission asks become the chat's Accept/Reject cards, and ask_user
 * questions use VS Code's own quick pick / input box.
 */
import * as vscode from "vscode";
import WebSocket from "ws";
import type { Logger } from "winston";
import type { ExtensionState } from "../extensionState";
import { executeExtensionCommand } from "../commands";
import { getRepositoryInfo } from "../utilities/git";
import { pendingPermissions } from "../features/agent/init";
import {
  handlePermissionRequest,
  retireCancelledPermissions,
  type PermissionResponder,
} from "../features/agent/toolPermissionHandler";
import type { PermissionRequestData } from "../client/agentBackendClient";
import { HubAgentApi, HubAgentApiError } from "./hubAgentApi";
import {
  HubAcpViewer,
  type ElicitationAsk,
  type PermissionAsk,
  type PermissionResult,
  type RunUpdate,
  type WebSocketLike,
} from "./hubAcpViewer";
import { ClusterRunTranscript, answerChoices, answerField } from "./transcript";
import { describeStages, missedStages, nextFollowStep } from "./workflowFollow";
import {
  ACP_FINISHED_REASON,
  DEFAULT_WORKFLOW,
  MANAGED_LABEL,
  acpReady,
  isTerminalPhase,
  type AgentResource,
  type AgentRun,
  type AgentWorkflow,
  type AgentWorkflowRun,
  type ExecutionMode,
} from "./contract";

const POLL_MS = 3_000;
const READY_TIMEOUT_MS = 10 * 60_000;

/**
 * How long the harness waits for an attached viewer to answer a permission
 * ask or an ask_user question before it fails the run:
 * HARNESS_HITL_TIMEOUT_SECONDS, 180 by default, at most 600
 * (agentic-controller harness README). The IDE cannot read the pod's value,
 * so it states the default.
 */
const ASK_TIMEOUT_HINT = "about 3 minutes";

type RunTarget =
  | { kind: "workflow"; workflow: AgentWorkflow }
  | { kind: "agent"; agent: AgentResource };

interface RunContext {
  state: ExtensionState;
  api: HubAgentApi;
  transcript: ClusterRunTranscript;
  insecure: boolean;
  log: Logger;
}

export async function runClusterAgent(state: ExtensionState, logger: Logger): Promise<void> {
  const log = logger.child({ component: "ClusterRun" });
  const hub = state.hubConnectionManager;
  const baseUrl = hub.getHubUrl();
  const profileSync = hub.getProfileSyncClient();
  if (!baseUrl || !profileSync) {
    vscode.window.showWarningMessage(
      "Running on the cluster needs a Hub connection with profile sync. Configure the Hub first.",
    );
    return;
  }
  if (state.data.isFetchingSolution) {
    vscode.window.showWarningMessage("Wait for the current solution run to finish first.");
    return;
  }

  const api = new HubAgentApi({
    baseUrl,
    bearerToken: hub.getBearerToken(),
    fetchFn: hub.getScopedFetch(),
  });

  try {
    const application = await findApplication(state, profileSync, log);
    if (!application) {
      return;
    }
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
    const targetBranch = await vscode.window.showInputBox({
      title: "Branch the agent pushes its changes to",
      value: defaultTargetBranch(),
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : "A branch name is required"),
    });
    if (!targetBranch) {
      return;
    }
    const branch = targetBranch.trim();

    void executeExtensionCommand("openChat");
    const ctx = (name: string): RunContext => ({
      state,
      api,
      transcript: new ClusterRunTranscript(state, name),
      insecure: hub.isInsecure(),
      log,
    });

    if (target.kind === "workflow") {
      const run = await api.createWorkflowRun({
        workflowRef: target.workflow.metadata.name!,
        applicationId: application.id,
        targetBranch: branch,
      });
      const name = run.metadata.name!;
      log.info("AgentWorkflowRun created", { name, workflow: target.workflow.metadata.name });
      const c = ctx(name);
      c.transcript.note(
        `**Workflow run \`${name}\` started**: \`${target.workflow.metadata.name}\` for ` +
          `\`${application.name}\` (${describeStages(stageNames(target.workflow))}). ` +
          `Changes are pushed to \`${branch}\`.`,
      );
      await followWorkflow(c, name);
      return;
    }

    const run = await api.createRun({
      agentRef: target.agent.metadata.name!,
      applicationId: application.id,
      targetBranch: branch,
      mode: mode!,
      // The IDE user is watching, so the agent may ask questions. An
      // unanswered question fails the run (agentic-controller ADR 0017).
      askUser: mode === "approve",
    });
    const name = run.metadata.name!;
    log.info("AgentRun created", { name, agent: target.agent.metadata.name, mode });
    const c = ctx(name);
    c.transcript.note(
      `**Cluster run \`${name}\` started** with agent \`${target.agent.metadata.name}\` for ` +
        `\`${application.name}\`, mode \`${mode}\`. Changes are pushed to \`${branch}\`.`,
    );
    const ready = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Starting ${name}`,
        cancellable: true,
      },
      (progress, token) =>
        waitForAcpReady(api, name, token, (m) => progress.report({ message: m })),
    );
    if (ready !== "ready") {
      c.transcript.note(`**Cluster run \`${name}\`** could not be attached (${ready}).`);
      return;
    }
    await attach(c, name);
    const finalRun = await settledRun(api, name);
    c.transcript.note(
      finalRun ? describeRunEnd(finalRun) : `**Cluster run \`${name}\` disconnected.**`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Cluster run failed", { error: message });
    vscode.window.showErrorMessage(`Cluster run failed: ${message}`);
  }
}

/**
 * Follow a workflow run: attach to each stage's AgentRun as the controller
 * reaches it, note stages that ended before the IDE could attach, and report
 * the outcome. Cancelling the progress notification stops following; the
 * run itself continues on the cluster.
 */
async function followWorkflow(c: RunContext, name: string): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Following workflow run ${name}`,
      cancellable: true,
    },
    async (progress, token) => {
      const followed = new Set<string>();
      while (!token.isCancellationRequested) {
        const run = await c.api.getWorkflowRun(name);
        for (const stage of missedStages(run, followed)) {
          followed.add(stage.agentRunName!);
          c.transcript.note(
            `Stage \`${stage.name}\` ${stage.phase.toLowerCase()} before the IDE attached.`,
          );
        }
        const step = nextFollowStep(run, followed);
        if (step.kind === "done") {
          c.transcript.note(describeWorkflowEnd(run));
          return;
        }
        if (step.kind === "wait") {
          progress.report({ message: waitingMessage(run) });
          await sleep(POLL_MS);
          continue;
        }

        const { stage, agentRunName } = step;
        followed.add(agentRunName);
        progress.report({ message: `stage ${stage.name}` });
        const ready = await waitForAcpReady(c.api, agentRunName, token, (m) =>
          progress.report({ message: `stage ${stage.name}: ${m}` }),
        );
        if (ready === "cancelled") {
          break;
        }
        if (ready !== "ready") {
          c.transcript.note(`Stage \`${stage.name}\` could not be attached (${ready}).`);
          continue;
        }
        const mode = stage.execution?.mode ?? "auto";
        c.transcript.note(
          `**Stage \`${stage.name}\`**: agent \`${stage.agentRef ?? "?"}\`, mode \`${mode}\`` +
            (stage.execution?.askUser ? ", may ask you questions." : "."),
        );
        await attach(c, agentRunName, token);
      }
      c.transcript.note(
        `Stopped following workflow run \`${name}\`. It continues on the cluster; follow it in the Konveyor console.`,
      );
    },
  );
}

function stageNames(workflow: AgentWorkflow): string[] {
  return (workflow.spec.stages ?? []).map((s) => s.name);
}

function waitingMessage(run: AgentWorkflowRun): string {
  const current = run.status?.currentStage;
  return current ? `waiting for stage ${current}` : (run.status?.phase ?? "Pending");
}

async function findApplication(
  state: ExtensionState,
  profileSync: NonNullable<
    ReturnType<ExtensionState["hubConnectionManager"]["getProfileSyncClient"]>
  >,
  log: Logger,
) {
  const repoInfo = await getRepositoryInfo(state.data.workspaceRoot, log);
  if (!repoInfo) {
    vscode.window.showWarningMessage("The workspace is not a git repository with a remote.");
    return null;
  }
  const application = await profileSync.findApplicationForWorkspace(repoInfo);
  if (!application) {
    vscode.window.showWarningMessage(
      `No Hub application matches this repository (${repoInfo.remoteUrl}). Add it to the Hub inventory first.`,
    );
  }
  return application;
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
        description: describeStages(stageNames(workflow)),
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
    title: "Run on the cluster",
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
        detail: `Each file edit and command needs your approval in the chat, within ${ASK_TIMEOUT_HINT}.`,
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

/** Poll an AgentRun until its ACP endpoint accepts connections. */
async function waitForAcpReady(
  api: HubAgentApi,
  runName: string,
  token: vscode.CancellationToken,
  report: (message: string) => void,
): Promise<"ready" | "ended" | "timed out" | "cancelled"> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (token.isCancellationRequested) {
      return "cancelled";
    }
    const run = await api.getRun(runName);
    const ready = acpReady(run);
    if (ready?.status === "True") {
      return "ready";
    }
    if (isTerminalPhase(run.status?.phase) || ready?.reason === ACP_FINISHED_REASON) {
      return "ended";
    }
    report(ready?.message ?? run.status?.phase ?? "Pending");
    await sleep(POLL_MS);
  }
  return "timed out";
}

/**
 * Attach to one AgentRun and follow it until its ACP socket closes (the run
 * or stage ended) or `token` is cancelled.
 */
async function attach(
  c: RunContext,
  runName: string,
  token?: vscode.CancellationToken,
): Promise<void> {
  const { state, api, transcript } = c;
  const nonce = await api.mintAcpNonce(runName);
  const viewer = await HubAcpViewer.connect(
    api.acpUrl(runName, nonce),
    (url) => new WebSocket(url, { rejectUnauthorized: !c.insecure }) as unknown as WebSocketLike,
  );
  c.log.info("Attached to AgentRun", { runName });
  const cancelListener = token?.onCancellationRequested(() => viewer.close());

  // Permission asks reuse the chat's Accept/Reject cards; the tee's ask ids
  // are mapped onto the numeric ids those cards use.
  let nextRequestId = 1;
  const askIdsByRequest = new Map<number, string | number>();
  const responder: PermissionResponder = {
    isPermissionPending: (id) => askIdsByRequest.has(id) && !viewer.isClosed,
    respondToRequest: (id, result) => {
      const askId = askIdsByRequest.get(id);
      if (askId !== undefined) {
        askIdsByRequest.delete(id);
        viewer.respondPermission(askId, result as PermissionResult);
      }
    },
  };
  const mutate = (recipe: Parameters<ExtensionState["mutate"]>[0]) => state.mutate(recipe);
  const openQuestions = new Map<string | number, { hide(): void }>();

  viewer.on("update", (update: RunUpdate) => transcript.apply(update));
  viewer.on("permission", (ask: PermissionAsk) => {
    const requestId = nextRequestId++;
    askIdsByRequest.set(requestId, ask.askId);
    transcript.breakText();
    void handlePermissionRequest({
      agentClient: responder,
      data: toPermissionData(requestId, ask),
      workspaceRoot: state.data.workspaceRoot,
      fileTracker: undefined,
      mutate,
      pendingPermissions,
      // The change happens in the run's own checkout, not in this workspace.
      reportFileOutcome: false,
    });
    warnAskDeadline("approval");
  });
  viewer.on("elicitation", (ask: ElicitationAsk) => {
    transcript.note(`**The agent asks:** ${ask.message}`);
    openQuestions.set(
      ask.askId,
      askQuestion(ask, (answer) => {
        openQuestions.delete(ask.askId);
        if (answer === undefined) {
          viewer.respondElicitation(ask.askId, { action: "decline" });
          transcript.note("_You declined to answer._");
        } else {
          viewer.respondElicitation(ask.askId, {
            action: "accept",
            content: { [answerField(ask)]: answer },
          });
          transcript.note(`**You answered:** ${answer}`);
        }
      }),
    );
  });
  viewer.on("askResolved", (askId: string | number) => {
    const question = openQuestions.get(askId);
    if (question) {
      openQuestions.delete(askId);
      question.hide();
      transcript.note("_This question was answered elsewhere or timed out._");
      return;
    }
    for (const [requestId, id] of askIdsByRequest) {
      if (id === askId) {
        askIdsByRequest.delete(requestId);
        retireCancelledPermissions(responder, [requestId], pendingPermissions, mutate);
      }
    }
  });

  await new Promise<void>((resolve) => {
    if (viewer.isClosed) {
      resolve();
    } else {
      viewer.once("close", () => resolve());
    }
  });
  cancelListener?.dispose();
  for (const question of openQuestions.values()) {
    question.hide();
  }
  const pendingIds = Array.from(askIdsByRequest.keys());
  askIdsByRequest.clear();
  retireCancelledPermissions(responder, pendingIds, pendingPermissions, mutate);
  transcript.finishTools();
}

/**
 * The harness fails the run if an ask goes unanswered for
 * HARNESS_HITL_TIMEOUT_SECONDS, so say so where the user will see it.
 */
function warnAskDeadline(what: "approval"): void {
  void vscode.window
    .showWarningMessage(
      `The agent on the cluster is waiting for your ${what}. Answer within ${ASK_TIMEOUT_HINT} or the run fails.`,
      "Open chat",
    )
    .then((choice) => {
      if (choice === "Open chat") {
        void executeExtensionCommand("openChat");
      }
    });
}

/** The run's status once it has ended, or null if it has not after a few checks. */
async function settledRun(api: HubAgentApi, runName: string): Promise<AgentRun | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const run = await api.getRun(runName);
      if (isTerminalPhase(run.status?.phase)) {
        return run;
      }
    } catch {
      // keep trying a few times
    }
    await sleep(2_000);
  }
  return null;
}

function targetBranchOf(
  env: Array<{ name: string; value: string }> | undefined,
): string | undefined {
  return env?.find((e) => e.name === "TARGET_BRANCH")?.value;
}

function describeRunEnd(run: AgentRun): string {
  const name = run.metadata.name;
  const branch = targetBranchOf(run.spec.env);
  if (run.status?.phase === "Succeeded") {
    return (
      `**Cluster run \`${name}\` succeeded.**` +
      (branch ? ` The agent pushed its changes to \`${branch}\`.` : "")
    );
  }
  const t = run.status?.terminationData;
  const why = [run.status?.phase, t?.outcome, t?.stopReason].filter(Boolean).join(", ");
  return `**Cluster run \`${name}\` failed** (${why || "unknown"}).`;
}

function describeWorkflowEnd(run: AgentWorkflowRun): string {
  const name = run.metadata.name;
  const branch = targetBranchOf(run.spec.env);
  if (run.status?.phase === "Succeeded") {
    return (
      `**Workflow run \`${name}\` succeeded.**` +
      (branch ? ` Its stages pushed their changes to \`${branch}\`.` : "")
    );
  }
  const failed = run.status?.stages?.find((s) => s.phase === "Failed");
  return `**Workflow run \`${name}\` failed**${failed ? ` at stage \`${failed.name}\`` : ""}.`;
}

function toPermissionData(requestId: number, ask: PermissionAsk): PermissionRequestData {
  const raw = ask.toolCall.rawInput;
  const locations = (ask.toolCall.locations ?? [])
    .map((l) => l.path)
    .filter((p): p is string => typeof p === "string");
  return {
    requestId,
    toolCallId: ask.toolCall.toolCallId,
    title: ask.toolCall.title ?? "Tool call",
    kind: ask.toolCall.kind ?? "other",
    status: ask.toolCall.status ?? "pending",
    rawInput:
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : undefined,
    locations: locations.length > 0 ? locations : undefined,
    options: ask.options.map((o) => ({
      optionId: o.optionId,
      name: o.name,
      kind: o.kind as PermissionRequestData["options"][number]["kind"],
    })),
  };
}

/**
 * Ask in VS Code's own UI. Calls `done` once with the answer, or undefined
 * if the user dismissed it. The returned handle closes it when the question
 * is concluded elsewhere (and then `done` is not called).
 */
function askQuestion(
  ask: ElicitationAsk,
  done: (answer: string | undefined) => void,
): { hide(): void } {
  const title = `The agent asks (answer within ${ASK_TIMEOUT_HINT})`;
  let finished = false;
  const finish = (answer: string | undefined) => {
    if (!finished) {
      finished = true;
      done(answer);
    }
  };
  const choices = answerChoices(ask);
  if (choices.length > 0) {
    const pick = vscode.window.createQuickPick();
    pick.title = title;
    pick.placeholder = ask.message;
    pick.ignoreFocusOut = true;
    pick.items = choices.map((label) => ({ label }));
    pick.onDidAccept(() => {
      finish(pick.selectedItems[0]?.label);
      pick.hide();
    });
    pick.onDidHide(() => {
      finish(undefined);
      pick.dispose();
    });
    pick.show();
    return {
      hide: () => {
        finished = true;
        pick.hide();
      },
    };
  }
  const box = vscode.window.createInputBox();
  box.title = title;
  box.prompt = ask.message;
  box.ignoreFocusOut = true;
  box.onDidAccept(() => {
    if (box.value.trim()) {
      finish(box.value.trim());
      box.hide();
    }
  });
  box.onDidHide(() => {
    finish(undefined);
    box.dispose();
  });
  box.show();
  return {
    hide: () => {
      finished = true;
      box.hide();
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
