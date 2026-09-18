import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchArtifactsForRun, fetchFirstSuccessfulRun } from "./_github.js";

const HEAD_SHA = "e4e2467d96abcb3b01606397996007dad1877427";
const OLD_SHA = "dfddc407d8c3095286317209ef30341816723215";

function workflowRun(id, headBranch, headSha, overrides = {}) {
  return {
    id,
    head_branch: headBranch,
    head_sha: headSha,
    status: "completed",
    conclusion: "success",
    url: `https://api.github.com/repos/konveyor/example/actions/runs/${id}`,
    ...overrides,
  };
}

/**
 * Fake the GitHub API requests made by fetchFirstSuccessfulRun, applying the same filters GitHub
 * does. `runs` are the workflow's runs, newest first. `branchListing` is what listing the branch's
 * runs returns, since GitHub doesn't always return that listing complete or current.
 */
function fakeOctokit({ runs, branchListing = runs, expiredRunIds = [] }) {
  const requests = [];
  const request = async (route, params) => {
    requests.push({ route, params });
    if (route.startsWith("GET /repos/{owner}/{repo}/branches/{branch}")) {
      return { data: { commit: { sha: HEAD_SHA } } };
    }
    if (route.startsWith("GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs")) {
      const workflowRuns = (params.head_sha ? runs : branchListing).filter(
        (run) =>
          (!params.head_sha || run.head_sha === params.head_sha) &&
          (!params.branch || run.head_branch === params.branch) &&
          (!params.status || [run.status, run.conclusion].includes(params.status)),
      );
      return { data: { workflow_runs: workflowRuns.slice(0, params.per_page) } };
    }
    if (route.startsWith("GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts")) {
      const expired = expiredRunIds.includes(params.run_id);
      const artifacts = ["provider-linux-x86_64", "provider-windows-x86_64"].map((name) => ({
        name,
        archive_download_url: `https://api.github.com/artifacts/${params.run_id}-${name}/zip`,
        expired,
      }));
      return { data: { artifacts } };
    }
    throw new Error(`Unexpected request: ${route}`);
  };
  return { request, requests };
}

test("uses the branch's run for the head commit when tags point at the same commit", async (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});

  // konveyor/c-sharp-analyzer-provider in September 2026: main's head commit was also tagged
  // v0.11.0-alpha.3 and v0.11.0-alpha.4, and the listing of main's runs offered a run whose
  // artifacts had expired.
  const octokit = fakeOctokit({
    runs: [
      workflowRun(34609879258, "v0.11.0-alpha.4", HEAD_SHA),
      workflowRun(34498939764, "v0.11.0-alpha.3", HEAD_SHA),
      workflowRun(34293869743, "main", HEAD_SHA),
      workflowRun(27024148400, "main", OLD_SHA),
    ],
    branchListing: [workflowRun(27024148400, "main", OLD_SHA)],
    expiredRunIds: [27024148400],
  });

  const result = await fetchFirstSuccessfulRun(octokit, "main", "release-binaries.yml");

  assert.equal(result.workflowRunId, 34293869743);
  assert.equal(result.headSha, HEAD_SHA);
  assert.ok(
    !octokit.requests.some(({ params }) => params.status),
    "the branch listing should not be needed",
  );
});

test("falls back past runs whose artifacts have expired", async (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});

  const octokit = fakeOctokit({
    runs: [workflowRun(3, "main", HEAD_SHA, { status: "in_progress", conclusion: null })],
    branchListing: [
      workflowRun(2, "main", OLD_SHA),
      workflowRun(1, "main", "a".repeat(40)),
      workflowRun(0, "main", "b".repeat(40)),
    ],
    expiredRunIds: [2],
  });

  const result = await fetchFirstSuccessfulRun(octokit, "main", "release-binaries.yml");

  assert.equal(result.workflowRunId, 1);
  assert.equal(result.headSha, "a".repeat(40));
});

test("fails clearly when no recent successful run has downloadable artifacts", async (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});

  const runs = [workflowRun(2, "main", HEAD_SHA), workflowRun(1, "main", OLD_SHA)];
  const octokit = fakeOctokit({ runs, expiredRunIds: [1, 2] });

  await assert.rejects(
    fetchFirstSuccessfulRun(octokit, "main", "release-binaries.yml"),
    /None of the 2 most recent successful release-binaries.yml runs on main have downloadable artifacts/,
  );
});

test("reads every page of a run's artifacts", async () => {
  const artifacts = Array.from({ length: 130 }, (_, i) => ({
    name: `artifact-${i}`,
    archive_download_url: `https://api.github.com/artifacts/${i}/zip`,
    expired: i === 129,
  }));
  const pages = [];
  const octokit = {
    // GitHub returns 30 artifacts per page unless asked for more, and at most 100
    request: async (route, { per_page = 30, page = 1 }) => {
      pages.push(page);
      const perPage = Math.min(per_page, 100);
      const start = (page - 1) * perPage;
      return { data: { artifacts: artifacts.slice(start, start + perPage) } };
    },
  };

  const result = await fetchArtifactsForRun(octokit, 1);

  assert.equal(result.length, 130);
  assert.equal(result.at(-1).expired, true);
  assert.deepEqual(pages, [1, 2]);
});
