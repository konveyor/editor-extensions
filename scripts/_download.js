import { join, basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import { Octokit } from "@octokit/core";
import fs from "fs-extra";
import { blue, bold, green, yellow } from "colorette";

import { fileSha256, isFile, relativeToCwd } from "./_util.js";
import {
  fetchGitHubReleaseMetadata,
  fetchGitHubTagSha,
  fetchFirstSuccessfulRun,
  fetchArtifactsForRun,
} from "./_github.js";
import { unpackAsset, unpackTarGz } from "./_unpack.js";

/**
 * @param {string} targetFile
 * @param {Response} fetchResponse
 * @returns {Promise<string>} sha256 hash of the response data
 */
async function streamResponseToFile(targetFile, fetchResponse) {
  const reader = Readable.fromWeb(fetchResponse.body);

  // setup stream to file
  const fileStream = fs.createWriteStream(targetFile);
  const pipeToFile = pipeline(reader, fileStream);

  // setup stream to calculate the sha256 hash of the file
  const hash = createHash("sha256");
  const pipeToHash = pipeline(reader, hash);

  // run them both, reject if either rejects, resolve with the hash
  await Promise.all([pipeToFile, pipeToHash]);

  // push the server side last modified time to the downloaded file for caching purposes
  const lastModified = fetchResponse.headers.get("Last-Modified");
  if (lastModified) {
    await fs.utimes(targetFile, new Date(lastModified), new Date(lastModified));
  }
  return hash.digest("hex");
}

export async function downloadUrl({ downloadDirectory, url, targetFileName, sha256, bearerToken }) {
  const fileName = targetFileName ?? basename(new URL(url).pathname);
  const targetFile = join(downloadDirectory, fileName);
  const meta = {
    url,
    fileName,
    lastModified: null,
    etag: null,
  };

  console.group(bold("Download:"), blue(url));
  console.log("Destination:", downloadDirectory);
  try {
    await fs.ensureDir(downloadDirectory);

    const headers = {};
    if (bearerToken) {
      headers["Authorization"] = `Bearer ${bearerToken}`;
    }

    let existingFileHash;
    if ((await isFile(targetFile)) && (await isFile(targetFile + ".etag"))) {
      try {
        existingFileHash = await fileSha256(targetFile);
        const etagFile = await fs.readFile(targetFile + ".etag");
        const [hash, etag] = etagFile.toString().split(",");
        if (hash === existingFileHash) {
          headers["If-None-Match"] = etag;
          console.log(`Found existing file sha256: ${green(hash)}, ETag: ${green(etag)}`);
        }
      } catch (err) {
        console.log("Skipping ETag check", err);
      }
    }

    console.log("Downloading:", yellow(fileName));
    const response = await fetch(url, { headers });
    if (!response.ok && response.status !== 304) {
      throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }
    if (response.status === 304) {
      console.log("The downloaded copy is current!");
    }
    const downloadSha256 =
      response.status === 304
        ? (existingFileHash ?? (await fileSha256(targetFile)))
        : await streamResponseToFile(targetFile, response);

    // If a sha256 is provided, verify against the downloaded file
    console.log(`Asset sha256: ${green(downloadSha256)}`);
    if (sha256) {
      if (downloadSha256 === sha256) {
        console.log(`${green("Verified!")} Asset's sha256 matches expected`);
      } else {
        throw new Error(
          `Downloaded file ${targetFile} sha256 ${downloadSha256} does not match the expected sha256 ${sha256}`,
        );
      }
    }

    meta.sha256 = downloadSha256;
    meta.lastModified = response.headers.get("Last-Modified") ?? headers["If-Modified-Since"];
    meta.etag = response.headers.get("ETag");
    await fs.writeFile(targetFile + ".etag", [meta.sha256, meta.etag].join(","));
  } catch (error) {
    console.error("Error downloading:", error);
    throw error;
  } finally {
    console.groupEnd();
  }

  return [targetFile, meta];
}

export async function downloadGitHubReleaseAssets({
  targetDirectory,
  org,
  repo,
  releaseTag,
  bearerToken,
  assets,
}) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  octokit.request = octokit.request.defaults({ owner: org, repo });
  const metadata = {
    org,
    repo,
    releaseTag,
  };

  console.group(
    `Download release assets, GitHub repo: ${yellow(`${org}/${repo}`)}, release: ${yellow(releaseTag)}`,
  );
  try {
    const releaseData = await fetchGitHubReleaseMetadata(octokit, releaseTag);
    const commitId = await fetchGitHubTagSha(octokit, releaseTag);
    const releaseAssets = releaseData.assets;

    metadata.commitId = commitId;
    metadata.collectedAt = new Date().toISOString();
    metadata.assets = [];

    for (const { name } of assets) {
      const releaseAsset = releaseAssets.find((a) => a.name === name);
      if (!releaseAsset) {
        throw new Error(
          `Asset [${yellow(name)}] was not found in GitHub release ${releaseData.html_url}`,
        );
      }

      const [, assetMeta] = await downloadUrl({
        downloadDirectory: targetDirectory,
        targetFileName: name,
        url: releaseAsset.browser_download_url,
        bearerToken,
      });

      metadata.assets.push({
        name,
        ...assetMeta,
      });
    }
  } finally {
    console.groupEnd();
  }

  return metadata;
}

export async function downloadGitHubReleaseSourceCode({
  targetDirectory,
  org,
  repo,
  releaseTag,
  bearerToken,
}) {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  octokit.request = octokit.request.defaults({ owner: org, repo });
  const metadata = {
    org,
    repo,
    releaseTag,
  };

  console.group(
    `Download sources, GitHub repo: ${yellow(`${org}/${repo}`)}, release: ${yellow(releaseTag)}`,
  );
  try {
    const releaseData = await fetchGitHubReleaseMetadata(octokit, releaseTag);
    const commitId = await fetchGitHubTagSha(octokit, releaseTag);

    const [, assetMeta] = await downloadUrl({
      downloadDirectory: targetDirectory,
      targetFileName: `${org}-${repo}-${releaseTag}-sources.zip`,
      url: releaseData.zipball_url,
      bearerToken,
    });

    metadata.commitId = commitId;
    metadata.collectedAt = new Date().toISOString();
    metadata.sourceCode = assetMeta;
  } finally {
    console.groupEnd();
  }

  return metadata;
}

export async function downloadAndExtractGitHubReleaseSourceCode({
  downloadDirectory,
  targetDirectory,
  org,
  repo,
  releaseTag,
  bearerToken,
  context,
  globs,
}) {
  let meta = {};
  console.group("Download and extract GitHub repo sources");
  try {
    const releaseMeta = await downloadGitHubReleaseSourceCode({
      targetDirectory: downloadDirectory,
      org,
      repo,
      releaseTag,
      bearerToken,
    });
    const zipballRoot = `${org}-${repo}-${releaseMeta.commitId.substring(0, 7)}`;
    await fs.ensureDir(targetDirectory);
    const assetMeta = await unpackAsset({
      sourceFile: join(downloadDirectory, releaseMeta.sourceCode.fileName),
      targetDirectory,
      context: !context ? zipballRoot : context.replace("{{root}}", zipballRoot),
      globs,
    });

    meta = {
      ...releaseMeta,
      sources: assetMeta,
    };
  } finally {
    console.groupEnd();
  }

  return meta;
}

export async function downloadAndExtractTarGz({ downloadDirectory, targetDirectory, url, sha256 }) {
  let meta = {
    url,
    fileName: null,
    sha256,
    lastModified: null,
    etag: null,
    fileSetDirectory: relativeToCwd(targetDirectory),
  };

  console.group("Download and extract:", blue(url));
  try {
    // Download the file
    const [targetFile, urlMeta] = await downloadUrl({ downloadDirectory, url, sha256 });
    meta = { ...meta, ...urlMeta };

    // Extract the tar.gz file
    console.group(bold("Unpacking:"), yellow(targetFile));
    console.log(`Destination: ${targetDirectory}`);
    try {
      await fs.ensureDir(targetDirectory);
      meta.fileSet = await unpackTarGz({
        sourceFile: targetFile,
        targetDirectory,
      });
      console.log(`Extracted ${green(meta.fileSet.length)} items`);
    } finally {
      console.groupEnd();
    }
  } catch (error) {
    console.error("Error downloading/extracting tar.gz:", error);
  } finally {
    console.groupEnd();
  }

  return meta;
}

/**
 * Download workflow artifacts and extract contents as assets
 */
export async function downloadWorkflowArtifactsAndExtractAssets({
  downloadDirectory,
  targetDirectory,
  org,
  repo,
  branch,
  workflow,
  bearerToken,
  artifacts,
}) {
  if (!bearerToken) {
    const errorMessage =
      "A bearer token is required. Ensure the GITHUB_TOKEN environment variable is set.";
    console.error(errorMessage);
    throw new Error(errorMessage);
  }

  const octokit = new Octokit({ auth: bearerToken });
  octokit.request = octokit.request.defaults({ owner: org, repo });
  const metadata = {
    org,
    repo,
    branch,
    workflow,
  };

  console.group(
    `Download workflow artifacts, GitHub repo: ${yellow(`${org}/${repo}`)}, branch: ${yellow(branch)}, workflow: ${yellow(workflow)}`,
  );
  try {
    await fs.ensureDir(targetDirectory);

    // Figure out the source workflow artifacts
    const { workflowRunId, workflowRunUrl, headSha } = await fetchFirstSuccessfulRun(
      octokit,
      branch,
      workflow,
    );
    if (!workflowRunId) {
      throw new Error("No successful workflow runs found.");
    }

    const artifactUrls = await fetchArtifactsForRun(octokit, workflowRunId);
    if (!artifactUrls || artifactUrls.length === 0) {
      throw new Error("No artifacts found for the workflow run.");
    }

    console.log(`Using workflow run: ${yellow(workflowRunId)}, url: ${workflowRunUrl}`);
    console.log(`Branch head commit sha: ${yellow(headSha)}`);
    console.log("Found workflow artifacts:", artifactUrls);

    metadata.workflowRunId = workflowRunId;
    metadata.commitId = headSha;
    metadata.collectedAt = new Date().toISOString();
    metadata.artifacts = [];

    // Download and unpack contents from the artifacts
    for (const { name, contents } of artifacts) {
      const artifact = artifactUrls.find((a) => a.name === name);
      if (!artifact) {
        console.warn(`Artifact [${name}] was not found in the workflow artifacts.`);
        continue;
      }

      console.group(yellow(name));
      try {
        const [downloadedFile, artifactMeta] = await downloadUrl({
          downloadDirectory,
          targetFileName: name,
          url: artifact.url,
          bearerToken,
        });

        await fs.ensureDir(targetDirectory);
        const assetMeta = await unpackAsset({
          sourceFile: downloadedFile,
          globs: contents,
          targetDirectory,
        });

        metadata.artifacts.push({
          name,
          ...artifactMeta,
          ...assetMeta,
        });
      } finally {
        console.groupEnd();
      }
    }
  } finally {
    console.groupEnd();
  }

  return metadata;
}
