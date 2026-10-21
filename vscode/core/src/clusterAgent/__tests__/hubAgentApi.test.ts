import expect from "expect";
import { HubAgentApi, HubAgentApiError } from "../hubAgentApi";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function fakeFetch(respond: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const { status, body } = respond(call);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("HubAgentApi", () => {
  it("lists agents with the bearer token", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: [{ metadata: { name: "a" } }] }));
    const api = new HubAgentApi({
      baseUrl: "https://hub.example/",
      bearerToken: "tok",
      fetchFn: fn,
    });
    expect(await api.listAgents()).toEqual([{ metadata: { name: "a" } }]);
    expect(calls[0].url).toBe("https://hub.example/hub/agentic/agents");
    expect(calls[0].headers.Authorization).toBe("Bearer tok");
  });

  it("creates a run with the application context the harness needs", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: { metadata: { name: "ide-x" } } }));
    const api = new HubAgentApi({ baseUrl: "https://hub.example", bearerToken: null, fetchFn: fn });
    await api.createRun({
      agentRef: "migration-execute-agent",
      applicationId: 42,
      targetBranch: "konveyor/migration-1",
      mode: "approve",
      askUser: true,
    });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url).toBe("https://hub.example/hub/agentic/agentruns");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].body).toEqual({
      metadata: { generateName: "ide-", labels: { "konveyor.io/application": "42" } },
      spec: {
        agentRef: "migration-execute-agent",
        execution: { mode: "approve", askUser: true },
        env: [
          { name: "APP_ID", value: "42" },
          { name: "TARGET_BRANCH", value: "konveyor/migration-1" },
        ],
      },
    });
  });

  it("explains missing scopes and a Hub without the agentic API", async () => {
    const forbidden = fakeFetch(() => ({ status: 403, body: { error: "nope" } }));
    const api1 = new HubAgentApi({ baseUrl: "https://h", bearerToken: "t", fetchFn: forbidden.fn });
    await expect(api1.listAgents()).rejects.toThrow(/agentic scopes/);

    const missing = fakeFetch(() => ({ status: 404 }));
    const api2 = new HubAgentApi({ baseUrl: "https://h", bearerToken: "t", fetchFn: missing.fn });
    const err = await api2.listAgents().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubAgentApiError);
    expect((err as HubAgentApiError).status).toBe(404);
    expect((err as Error).message).toMatch(/0\.11 or newer/);
  });
});

describe("HubAgentApi workflows", () => {
  it("lists runs and workflow runs", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 200, body: [] }));
    const api = new HubAgentApi({ baseUrl: "https://hub.example", bearerToken: "t", fetchFn: fn });
    await api.listRuns();
    await api.listWorkflowRuns();
    expect(calls.map((c) => c.url)).toEqual([
      "https://hub.example/hub/agentic/agentruns",
      "https://hub.example/hub/agentic/workflowruns",
    ]);
  });

  it("lists workflows and reads a workflow run", async () => {
    const { fn, calls } = fakeFetch((call) => ({
      status: 200,
      body: call.url.endsWith("/workflows")
        ? [{ metadata: { name: "java-ee-to-quarkus" } }]
        : { metadata: { name: "ide-1" } },
    }));
    const api = new HubAgentApi({ baseUrl: "https://hub.example", bearerToken: "t", fetchFn: fn });
    expect(await api.listWorkflows()).toEqual([{ metadata: { name: "java-ee-to-quarkus" } }]);
    await api.getWorkflowRun("ide-1");
    expect(calls.map((c) => c.url)).toEqual([
      "https://hub.example/hub/agentic/workflows",
      "https://hub.example/hub/agentic/workflowruns/ide-1",
    ]);
  });

  it("starts a workflow run with the application context and no run-level mode", async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: { metadata: { name: "ide-1" } } }));
    const api = new HubAgentApi({ baseUrl: "https://hub.example", bearerToken: "t", fetchFn: fn });
    await api.createWorkflowRun({
      workflowRef: "java-ee-to-quarkus",
      applicationId: 7,
      targetBranch: "konveyor/migration-2",
    });
    expect(calls[0].url).toBe("https://hub.example/hub/agentic/workflowruns");
    expect(calls[0].body).toEqual({
      metadata: { generateName: "ide-", labels: { "konveyor.io/application": "7" } },
      spec: {
        workflowRef: "java-ee-to-quarkus",
        env: [
          { name: "APP_ID", value: "7" },
          { name: "TARGET_BRANCH", value: "konveyor/migration-2" },
        ],
      },
    });
  });
});
