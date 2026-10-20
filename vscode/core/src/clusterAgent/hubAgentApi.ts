/**
 * Client for the Hub's agentic API (tackle2-hub >= v0.11, internal/api/agentic.go).
 *
 * The Hub is the IDE's front door to cluster agents, the same as for
 * tackle2-ui: it lists Agents, creates AgentRuns (minting the run's Hub token
 * and HUB_BASE_URL itself), and proxies the run's ACP WebSocket after a
 * single-use nonce. Routes are guarded by the `agentic.*` scopes.
 */
import {
  APPLICATION_LABEL,
  type AgentResource,
  type AgentRun,
  type AgentWorkflow,
  type AgentWorkflowRun,
  type ExecutionMode,
} from "./contract";

export interface CreateWorkflowRunInput {
  workflowRef: string;
  /** Hub application id: becomes APP_ID and the application label. */
  applicationId: number;
  /** Branch the stages push to: becomes TARGET_BRANCH. */
  targetBranch: string;
  params?: Record<string, string>;
  gateway?: string;
}

export interface CreateRunInput {
  agentRef: string;
  /** Hub application id: becomes APP_ID and the application label. */
  applicationId: number;
  /** Branch the harness pushes to: becomes TARGET_BRANCH. */
  targetBranch: string;
  mode: ExecutionMode;
  /** Give the agent the ask_user tool; only for runs somebody watches. */
  askUser?: boolean;
  params?: Record<string, string>;
  instructions?: string;
  gateway?: string;
}

export class HubAgentApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "HubAgentApiError";
  }
}

export interface HubAgentApiOptions {
  /** Hub base URL, e.g. https://mta.example.com (no trailing /hub). */
  baseUrl: string;
  bearerToken: string | null;
  fetchFn?: typeof fetch;
}

export class HubAgentApi {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HubAgentApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private url(path: string): string {
    return `${this.baseUrl}/hub/agentic${path}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.options.bearerToken) {
      headers.Authorization = `Bearer ${this.options.bearerToken}`;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const response = await this.fetchFn(this.url(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new HubAgentApiError(
        describeFailure(method, path, response.status, text),
        response.status,
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  listAgents(): Promise<AgentResource[]> {
    return this.request<AgentResource[]>("GET", "/agents");
  }

  listWorkflows(): Promise<AgentWorkflow[]> {
    return this.request<AgentWorkflow[]>("GET", "/workflows");
  }

  getWorkflowRun(name: string): Promise<AgentWorkflowRun> {
    return this.request<AgentWorkflowRun>("GET", `/workflowruns/${encodeURIComponent(name)}`);
  }

  /**
   * Start a workflow run for an application. The controller creates one
   * AgentRun per stage, in order; each stage's mode and ask_user come from
   * the workflow definition (agentic-controller ADR 0011), not from the run.
   */
  createWorkflowRun(input: CreateWorkflowRunInput): Promise<AgentWorkflowRun> {
    const appId = String(input.applicationId);
    const params = Object.entries(input.params ?? {}).map(([name, value]) => ({ name, value }));
    const body: AgentWorkflowRun = {
      metadata: { generateName: "ide-", labels: { [APPLICATION_LABEL]: appId } },
      spec: {
        workflowRef: input.workflowRef,
        ...(params.length > 0 ? { params } : {}),
        ...(input.gateway ? { gateway: input.gateway } : {}),
        env: [
          { name: "APP_ID", value: appId },
          { name: "TARGET_BRANCH", value: input.targetBranch },
        ],
      },
    };
    return this.request<AgentWorkflowRun>("POST", "/workflowruns", body);
  }

  getRun(name: string): Promise<AgentRun> {
    return this.request<AgentRun>("GET", `/agentruns/${encodeURIComponent(name)}`);
  }

  /**
   * Create a run for an application. The creating client owns the app
   * context (APP_ID / TARGET_BRANCH); the Hub adds HUB_BASE_URL and the
   * run's token Secret. Managed agents fail fast without APP_ID.
   */
  createRun(input: CreateRunInput): Promise<AgentRun> {
    const appId = String(input.applicationId);
    const params = Object.entries(input.params ?? {}).map(([name, value]) => ({ name, value }));
    const body: AgentRun = {
      metadata: { generateName: "ide-", labels: { [APPLICATION_LABEL]: appId } },
      spec: {
        agentRef: input.agentRef,
        ...(params.length > 0 ? { params } : {}),
        ...(input.instructions ? { instructions: input.instructions } : {}),
        ...(input.gateway ? { gateway: input.gateway } : {}),
        execution: { mode: input.mode, ...(input.askUser ? { askUser: true } : {}) },
        env: [
          { name: "APP_ID", value: appId },
          { name: "TARGET_BRANCH", value: input.targetBranch },
        ],
      },
    };
    return this.request<AgentRun>("POST", "/agentruns", body);
  }

  /**
   * A single-use nonce (about 30 s) that authorizes one WebSocket upgrade to
   * the run's ACP endpoint. Mint one per dial; never reuse across retries.
   */
  mintAcpNonce(runName: string): Promise<string> {
    return this.request<string>("POST", `/agentruns/${encodeURIComponent(runName)}/acp/nonce`);
  }

  /** WebSocket URL for the run's ACP endpoint, authorized by `nonce`. */
  acpUrl(runName: string, nonce: string): string {
    const ws = this.url(`/agentruns/${encodeURIComponent(runName)}/acp`).replace(
      /^http(s?):/,
      "ws$1:",
    );
    return `${ws}?nonce=${encodeURIComponent(nonce)}`;
  }
}

function describeFailure(method: string, path: string, status: number, body: string): string {
  if (status === 401 || status === 403) {
    return `The Hub refused ${method} ${path} (${status}). Your account needs the agentic scopes for this action.`;
  }
  if (status === 404 && !path.startsWith("/agentruns/") && !path.startsWith("/workflowruns/")) {
    return `The Hub has no agentic API (${method} ${path} returned 404). It needs tackle2-hub 0.11 or newer with agentic enabled.`;
  }
  const detail = body.trim().slice(0, 300);
  return `Hub request ${method} ${path} failed with ${status}${detail ? `: ${detail}` : ""}`;
}
