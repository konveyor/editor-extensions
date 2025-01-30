/**
 * Fetch the most recent successful workflow run for the branch head.
 *
 * @param {string} org - GitHub organization or user.
 * @param {string} repo - GitHub repository name.
 * @param {string} workflowFile - Name of the workflow file.
 * @returns {Promise<{runId: string, headSha: string} | null>} - Object containing the workflow run ID and head SHA, or null if not found.
 */
export async function fetchFirstSuccessfulRun(org, repo, workflowFile) {
  try {
    console.log(`Fetching head commit SHA for branch: main`);
    const res = await fetch(`https://api.github.com/repos/${org}/${repo}/branches/main`, {
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch branch head SHA: ${res.statusText}`);
    }

    const data = await res.json();
    const headSha = data.commit.sha;
    console.log(`Head commit SHA: ${headSha}`);

    console.log(`Fetching workflow runs for head SHA: ${headSha}`);
    const workflowResponse = await fetch(
      `https://api.github.com/repos/${org}/${repo}/actions/workflows/${workflowFile}/runs?head_sha=${headSha}&per_page=1`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (!workflowResponse.ok) {
      throw new Error(`Failed to fetch workflow runs: ${workflowResponse.statusText}`);
    }

    const workflowData = await workflowResponse.json();
    if (workflowData.workflow_runs.length === 0) {
      console.log("No successful workflow runs found for the head commit.");
      return null;
    }

    const workflowRun = workflowData.workflow_runs[0];
    if (workflowRun.status !== "completed" || workflowRun.conclusion !== "success") {
      console.log(
        `Workflow run for head commit is not successful: Status = ${workflowRun.status}, Conclusion = ${workflowRun.conclusion}`,
      );
      return null;
    }

    console.log(`First Successful Workflow Run ID for head commit: ${workflowRun.id}`);
    return {
      workflowRunId: workflowRun.id,
      headSha: headSha,
    };
  } catch (error) {
    console.error("Error fetching workflow runs:", error.message);
    return null;
  }
}

/**
 * Fetch artifacts for a specific workflow run.
 *
 * @param {string} org - GitHub organization or user.
 * @param {string} repo - GitHub repository name.
 * @param {string} runId - ID of the workflow run.
 * @returns {Promise<Array>} - List of artifacts with download URLs.
 */
export async function fetchArtifactsForRun(org, repo, runId) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${org}/${repo}/actions/runs/${runId}/artifacts`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch artifacts: ${response.statusText}`);
    }

    const data = await response.json();
    const downloadUrls = data.artifacts.map((artifact) => ({
      name: artifact.name,
      url: artifact.archive_download_url,
    }));
    console.log("Artifact Download URLs:", downloadUrls);
    return downloadUrls;
  } catch (error) {
    console.error("Error fetching artifacts:", error.message);
    return [];
  }
}
