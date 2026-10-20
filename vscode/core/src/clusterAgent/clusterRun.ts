/**
 * "Run agent on cluster": start an AgentRun for the open application through
 * the Hub and follow it in the Migration Assistant chat (epic #1511).
 *
 * The cluster harness drives the agent; the IDE is a viewer. The run's
 * stream is written into the chat transcript, its permission asks become the
 * chat's Accept/Reject cards, and its questions (ask_user) use VS Code's own
 * quick pick / input box.
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
import { HubAgentApi } from "./hubAgentApi";
import {
  HubAcpViewer,
  type ElicitationAsk,
  type PermissionAsk,
  type PermissionResult,
  type RunUpdate,
  type WebSocketLike,
} from "./hubAcpViewer";
import { ClusterRunTranscript, answerField, answerChoices } from "./transcript";
import {
  ACP_FINISHED_REASON,
  MANAGED_LABEL,
  acpReady,
  isTerminalPhase,
  type AgentResource,
  type AgentRun,
  type ExecutionMode,
} from "./contract";

const READY_POLL_MS = 3_000;
const READY_TIMEOUT_MS = 10 * 60_000;

export async function runClusterAgent(state: ExtensionState, logger: Logger): Promise<void> {
  const log = logger.child({ component: "ClusterRun" });
  const hub = state.hubConnectionManager;
  const baseUrl = hub.getHubUrl();
  const profileSync = hub.getProfileSyncClient();
  if (!baseUrl || !profileSync) {
    vscode.window.showWarningMessage(
      "Running an agent on the cluster needs a Hub connection with profile sync. Configure the Hub first.",
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
    const agents = await api.listAgents();
    const agent = await pickAgent(agents);
    if (!agent) {
      return;
    }
    const mode = await pickMode();
    if (!mode) {
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

    const run = await api.createRun({
      agentRef: agent.metadata.name!,
      applicationId: application.id,
      targetBranch: targetBranch.trim(),
      mode,
      // The IDE user is watching, so the agent may ask questions. An
      // unanswered question fails the run (agentic-controller ADR 0017).
      askUser: mode === "approve",
    });
    const runName = run.metadata.name!;
    log.info("AgentRun created", { runName, agent: agent.metadata.name, mode, targetBranch });

    const ready = await waitForAcpReady(api, runName);
    if (!ready) {
      return;
    }

    void executeExtensionCommand("openChat");
    const transcript = new ClusterRunTranscript(state, runName);
    transcript.note(
      `**Cluster run \`${runName}\` started** with agent \`${agent.metadata.name}\` for ` +
        `\`${application.name}\`, mode \`${mode}\`. Changes are pushed to \`${targetBranch.trim()}\`.`,
    );
    await attach(state, api, runName, transcript, hub.isInsecure(), log);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Cluster run failed", { error: message });
    vscode.window.showErrorMessage(`Cluster agent run failed: ${message}`);
  }
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

async function pickAgent(agents: AgentResource[]): Promise<AgentResource | undefined> {
  if (agents.length === 0) {
    vscode.window.showWarningMessage("The Hub has no agents defined.");
    return undefined;
  }
  // Konveyor-managed agents take the application context we provide.
  const sorted = [...agents].sort((a, b) => {
    const am = a.metadata.labels?.[MANAGED_LABEL] === "true" ? 0 : 1;
    const bm = b.metadata.labels?.[MANAGED_LABEL] === "true" ? 0 : 1;
    return am - bm || (a.metadata.name ?? "").localeCompare(b.metadata.name ?? "");
  });
  const pick = await vscode.window.showQuickPick(
    sorted.map((agent) => ({
      label: agent.metadata.name ?? "(unnamed)",
      description: agent.metadata.labels?.[MANAGED_LABEL] === "true" ? "Konveyor" : undefined,
      detail: agent.spec.image,
      agent,
    })),
    { title: "Agent to run on the cluster", ignoreFocusOut: true },
  );
  return pick?.agent;
}

async function pickMode(): Promise<ExecutionMode | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: "Ask before changes",
        detail: "Each file edit and command needs your approval in the chat.",
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

/** Poll until the run's ACP endpoint accepts connections. */
async function waitForAcpReady(api: HubAgentApi, runName: string): Promise<boolean> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Starting agent run ${runName}`,
      cancellable: true,
    },
    async (progress, token) => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (!token.isCancellationRequested && Date.now() < deadline) {
        const run = await api.getRun(runName);
        const ready = acpReady(run);
        if (ready?.status === "True") {
          return true;
        }
        if (isTerminalPhase(run.status?.phase) || ready?.reason === ACP_FINISHED_REASON) {
          vscode.window.showErrorMessage(
            `Agent run ${runName} ended before it could be attached (${describeOutcome(run)}).`,
          );
          return false;
        }
        progress.report({ message: ready?.message ?? run.status?.phase ?? "Pending" });
        await sleep(READY_POLL_MS);
      }
      if (!token.isCancellationRequested) {
        vscode.window.showErrorMessage(`Agent run ${runName} did not become ready in time.`);
      }
      return false;
    },
  );
}

async function attach(
  state: ExtensionState,
  api: HubAgentApi,
  runName: string,
  transcript: ClusterRunTranscript,
  insecure: boolean,
  log: Logger,
): Promise<void> {
  const nonce = await api.mintAcpNonce(runName);
  const viewer = await HubAcpViewer.connect(
    api.acpUrl(runName, nonce),
    (url) => new WebSocket(url, { rejectUnauthorized: !insecure }) as unknown as WebSocketLike,
  );
  log.info("Attached to AgentRun", { runName });

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
      mutate: (recipe) => state.mutate(recipe),
      pendingPermissions,
      // The change happens in the run's own checkout, not in this workspace.
      reportFileOutcome: false,
    });
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
        retireCancelledPermissions(responder, [requestId], pendingPermissions, (recipe) =>
          state.mutate(recipe),
        );
      }
    }
  });

  await new Promise<void>((resolve) => viewer.once("close", () => resolve()));
  for (const question of openQuestions.values()) {
    question.hide();
  }
  const pendingIds = Array.from(askIdsByRequest.keys());
  askIdsByRequest.clear();
  retireCancelledPermissions(responder, pendingIds, pendingPermissions, (recipe) =>
    state.mutate(recipe),
  );
  transcript.finishTools();

  const finalRun = await settledRun(api, runName);
  transcript.note(
    finalRun ? describeEnd(finalRun) : `**Cluster run \`${runName}\` disconnected.**`,
  );
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

function describeOutcome(run: AgentRun): string {
  const t = run.status?.terminationData;
  return [run.status?.phase, t?.outcome, t?.stopReason].filter(Boolean).join(", ") || "unknown";
}

function describeEnd(run: AgentRun): string {
  const name = run.metadata.name;
  const branch = run.spec.env?.find((e) => e.name === "TARGET_BRANCH")?.value;
  if (run.status?.phase === "Succeeded") {
    return (
      `**Cluster run \`${name}\` succeeded.**` +
      (branch ? ` The agent pushed its changes to \`${branch}\`.` : "")
    );
  }
  return `**Cluster run \`${name}\` failed** (${describeOutcome(run)}).`;
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
    pick.title = "The agent asks";
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
  box.title = "The agent asks";
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
