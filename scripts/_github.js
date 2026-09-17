/** @import { Octokit } from "@octokit/core" */

/**
 * Fetch the JSON metadata for a GitHub repository release.
 *
 * @param {Octokit} octokit Octokit configured for auth and the target owner/repo
 * @param {string} releaseTag The release's tag
 */
export async function fetchGitHubReleaseMetadata(octokit, releaseTag) {
  const response = await octokit.request("GET /repos/{owner}/{repo}/releases/tags/{tag}", {
    tag: releaseTag,
  });

  return response.data;
}

/**
 * Fetch the commit sha for a GitHub repository tag.
 *
 * @param {Octokit} octokit Octokit configured for auth and the target owner/repo
 * @param {string} tag The commit's tag
 */
export async function fetchGitHubTagSha(octokit, tag) {
  const response = await octokit.request("GET /repos/{owner}/{repo}/commits/{tag}", {
    tag,
  });

  return await response.data.sha;
}

/**
 * Fetch the most recent successful workflow run for the branch head, falling back to the most
 * recent successful run on the branch. Runs without downloadable artifacts are skipped.
 *
 * @param {Octokit} octokit Octokit configured for auth and the target owner/repo
 * @param {string} branch Name of the branch to check
 * @param {string} workflowFile Name of the workflow file to check
 * @returns {Promise<{workflowRunId: number, workflowRunUrl: string, headSha: string}>} - Object containing the workflow run ID, API url and head SHA.
 * @throws {Error} If none of the recent successful runs on the branch have downloadable artifacts.
 */
export async function fetchFirstSuccessfulRun(octokit, branch, workflowFile) {
  const branchInfo = await octokit.request("GET /repos/{owner}/{repo}/branches/{branch}", {
    branch,
  });
  const headSha = branchInfo.data.commit.sha;

  // First, try to find a successful run for the HEAD commit. Filter on the branch too: pushing a
  // tag for the same commit starts runs with that head_sha whose head_branch is the tag, and
  // they are listed ahead of the branch's own run.
  const headWorkflowRunInfo = await octokit.request(
    "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs{?head_sha,branch,per_page}",
    {
      workflow_id: workflowFile,
      head_sha: headSha,
      branch,
      per_page: 1,
    },
  );

  const workflowRun = headWorkflowRunInfo.data.workflow_runs.find(
    (run) => run.head_branch === branch,
  );
  if (!workflowRun) {
    console.warn(`No workflow runs found for HEAD commit ${headSha} on ${branch}.`);
  } else if (workflowRun.status !== "completed" || workflowRun.conclusion !== "success") {
    console.warn(
      `Workflow run ${workflowRun.id} for HEAD commit on ${branch} is not successful. status: ${workflowRun.status}, conclusion: ${workflowRun.conclusion}`,
    );
  } else if (await hasDownloadableArtifacts(octokit, workflowRun.id)) {
    return {
      workflowRunId: workflowRun.id,
      workflowRunUrl: workflowRun.url,
      headSha: headSha,
    };
  } else {
    console.warn(
      `Workflow run ${workflowRun.id} for HEAD commit on ${branch} has no downloadable artifacts (expired or missing).`,
    );
  }

  // Fall back to the most recent successful run for the branch whose artifacts can be downloaded.
  // This listing is not always complete or current, so its first run may be months old.
  console.log(`Falling back to most recent successful run on ${branch}...`);
  const recentWorkflowRunInfo = await octokit.request(
    "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs{?branch,status,per_page}",
    {
      workflow_id: workflowFile,
      branch: branch,
      status: "success",
      per_page: 10,
    },
  );

  const successfulRuns = recentWorkflowRunInfo.data.workflow_runs.filter(
    (run) => run.conclusion === "success" && run.head_branch === branch,
  );
  if (successfulRuns.length === 0) {
    throw new Error(`No successful ${workflowFile} runs found on ${branch}.`);
  }

  for (const run of successfulRuns) {
    const shortSha = run.head_sha.substring(0, 7);
    if (!(await hasDownloadableArtifacts(octokit, run.id))) {
      console.warn(
        `Skipping workflow run ${run.id} from commit ${shortSha}: no downloadable artifacts (expired or missing).`,
      );
      continue;
    }

    console.log(`Found successful workflow run ${run.id} from commit ${shortSha}`);
    return {
      workflowRunId: run.id,
      workflowRunUrl: run.url,
      headSha: run.head_sha,
    };
  }

  throw new Error(
    `None of the ${successfulRuns.length} most recent successful ${workflowFile} runs on ${branch} have downloadable artifacts. Run the workflow on ${branch} again to produce new ones.`,
  );
}

/**
 * Check that a workflow run has artifacts and that none of them have expired. GitHub removes
 * artifacts when their retention period ends (90 days unless the workflow sets `retention-days`),
 * and downloading one after that fails with `410 Gone`.
 *
 * @param {Octokit} octokit Octokit configured for auth and the target owner/repo
 * @param {number} runId ID of the workflow run
 * @returns {Promise<boolean>}
 */
async function hasDownloadableArtifacts(octokit, runId) {
  const artifacts = await fetchArtifactsForRun(octokit, runId);
  return artifacts.length > 0 && artifacts.every((artifact) => !artifact.expired);
}

/**
 * Fetch the most recent successful workflow run for a PR.
 *
 * @param {Octokit} octokit Octokit configured for auth and the target owner/repo
 * @param {string} pr Number of the pull request to check
 * @param {string} workflowFile Name of the workflow file to check
 * @returns {Promise<{runId: string, headSha: string} | null>} - Object containing the workflow run ID and head SHA, or null if not found.
 */
export async function fetchFirstSuccessfulRunForPr(octokit, pr, workflowFile) {
  // Get PR information to get the head SHA
  const prInfo = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    pull_number: pr,
  });
  const headSha = prInfo.data.head.sha;

  const workflowRunInfo = await octokit.request(
    "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs{?head_sha,per_page}",
    {
      workflow_id: workflowFile,
      head_sha: headSha,
      per_page: 1,
    },
  );

  if (workflowRunInfo.data.workflow_runs.length === 0) {
    console.error(`No workflow runs found for PR #${pr} commit ${headSha}.`);
    return {};
  }

  const workflowRun = workflowRunInfo.data.workflow_runs[0];
  if (workflowRun.status !== "completed" || workflowRun.conclusion !== "success") {
    console.error(
      `Workflow run ${workflowRun.id} for PR #${pr} commit ${headSha} is not successful. status: ${workflowRun.status}, conclusion: ${workflowRun.conclusion}`,
    );
    return {};
  }

  return {
    workflowRunId: workflowRun.id,
    workflowRunUrl: workflowRun.url,
    headSha: headSha,
  };
}

/**
 * Fetch artifacts for a specific workflow run.
 *
 * @param {Octokit} octokit Octokit configured for auth and the target owner/repo
 * @param {string} runId - ID of the workflow run.
 * @returns {Promise<Array<{ name, url, expired }>>} - List of artifacts with download URLs and whether they have expired.
 */
export async function fetchArtifactsForRun(octokit, runId) {
  const r = await octokit.request("GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts", {
    run_id: runId,
  });

  const data = r.data;
  const downloadUrls = data.artifacts.map((artifact) => ({
    name: artifact.name,
    url: artifact.archive_download_url,
    expired: artifact.expired,
  }));
  return downloadUrls;
}
