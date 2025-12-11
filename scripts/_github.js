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
 * Fetch the most recent successful workflow run for the branch head.
 *
 * @param {Octokit} octokit Octokit configured for auth and the target owner/repo
 * @param {string} branch Name of the brach to check
 * @param {string} workflowFile Name of the workflow file to check
 * @returns {Promise<{runId: string, headSha: string} | null>} - Object containing the workflow run ID and head SHA, or null if not found.
 */
export async function fetchFirstSuccessfulRun(octokit, branch, workflowFile) {
  const branchInfo = await octokit.request("GET /repos/{owner}/{repo}/branches/{branch}", {
    branch,
  });
  const headSha = branchInfo.data.commit.sha;

  // First, try to find a successful run for the HEAD commit
  const headWorkflowRunInfo = await octokit.request(
    "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs{?head_sha,per_page}",
    {
      workflow_id: workflowFile,
      head_sha: headSha,
      per_page: 1,
    },
  );

  if (headWorkflowRunInfo.data.workflow_runs.length > 0) {
    const workflowRun = headWorkflowRunInfo.data.workflow_runs[0];
    if (workflowRun.status === "completed" && workflowRun.conclusion === "success") {
      return {
        workflowRunId: workflowRun.id,
        workflowRunUrl: workflowRun.url,
        headSha: headSha,
      };
    }
    console.warn(
      `Workflow run ${workflowRun.id} for HEAD commit on ${branch} is not successful. status: ${workflowRun.status}, conclusion: ${workflowRun.conclusion}`,
    );
  } else {
    console.warn(`No workflow runs found for HEAD commit ${headSha} on ${branch}.`);
  }

  // Fall back to finding the most recent successful run for the branch
  console.log(`Falling back to most recent successful run on ${branch}...`);
  const recentWorkflowRunInfo = await octokit.request(
    "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs{?branch,status,per_page}",
    {
      workflow_id: workflowFile,
      branch: branch,
      status: "completed",
      per_page: 10,
    },
  );

  const successfulRun = recentWorkflowRunInfo.data.workflow_runs.find(
    (run) => run.conclusion === "success",
  );

  if (!successfulRun) {
    console.error(`No successful workflow runs found on ${branch}.`);
    return {};
  }

  console.log(
    `Found successful workflow run ${successfulRun.id} from commit ${successfulRun.head_sha.substring(0, 7)}`,
  );

  return {
    workflowRunId: successfulRun.id,
    workflowRunUrl: successfulRun.url,
    headSha: successfulRun.head_sha,
  };
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
 * @returns {Promise<Array<{ name, url }>} - List of artifacts with download URLs.
 */
export async function fetchArtifactsForRun(octokit, runId) {
  const r = await octokit.request("GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts", {
    run_id: runId,
  });

  const data = r.data;
  const downloadUrls = data.artifacts.map((artifact) => ({
    name: artifact.name,
    url: artifact.archive_download_url,
  }));
  return downloadUrls;
}
