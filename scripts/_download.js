import { join, extname, basename } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import fs from "fs-extra";
import unzipper from "unzipper";
import * as tar from "tar";
import { bold, green, yellow } from "colorette";
import { chmodOwnerPlusX } from "./_util.js";

const GITHUB_API = "https://api.github.com";

/**
 * Fetch the JSON metadata for a GitHub repository release.
 *
 * @param {string} org GitHub organization/user for the release
 * @param {string} repo GitHub repository for the release
 * @param {string} releaseTag The release's tag
 * @returns {object}
 */
export async function getGitHubReleaseMetadata(org, repo, releaseTag) {
  const url = `${GITHUB_API}/repos/${org}/${repo}/releases/tags/${releaseTag}`;
  console.log(
    `Fetching GitHub release metadata for ${yellow(`${org}/${repo}`)} release: ${yellow(releaseTag)}`,
  );

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch release metadata: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Fetch the commit sha for a GitHub repository release.
 *
 * @param {string} org GitHub organization/user for the release
 * @param {string} repo GitHub repository for the release
 * @param {string} releaseTag The release's tag
 * @returns The release tag's commit sha
 */
export async function getGitHubReleaseTagSha(org, repo, releaseTag) {
  const url = `${GITHUB_API}/repos/${org}/${repo}/commits/${releaseTag}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.sha",
    },
  });

  return await response.text();
}

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
  try {
    await Promise.all([pipeToFile, pipeToHash]);
    return Promise.resolve(hash.digest("hex"));
  } catch (e) {
    return Promise.reject(e);
  }
}

export async function downloadAndExtractGitHubAsset(
  target,
  gitHubReleaseAsset,
  platform,
  arch,
  chmod = false,
) {
  const assetDir = join(target, `${platform}-${arch}`);
  const assetFileName = join(assetDir, gitHubReleaseAsset.name);

  await fs.ensureDir(assetDir);

  console.log(`Downloading asset: ${gitHubReleaseAsset.name}`);
  const response = await fetch(gitHubReleaseAsset.browser_download_url);
  if (!response.ok) {
    throw new Error(`Failed to download ${gitHubReleaseAsset.name}: ${response.statusText}`);
  }
  const sha256 = await streamResponseToFile(assetFileName, response);

  console.log(`Asset sha256: ${green(sha256)}`);
  console.log(`Extracting to: ${assetDir}`);
  const zipFile = await unzipper.Open.file(assetFileName);
  await zipFile.extract({ path: assetDir });

  const extractedFiles = await fs.readdir(assetDir);
  extractedFiles.forEach(async (file) => {
    if (chmod && extname(file) !== ".zip") {
      chmodOwnerPlusX(join(assetDir, file));
    }
  });

  console.log(`Extracted: ${gitHubReleaseAsset.name}`);
}

export async function downloadGitHubRelease({
  targetDirectory,
  metaFile,
  org,
  repo,
  releaseTag,
  assets,
}) {
  try {
    const releaseData = await getGitHubReleaseMetadata(org, repo, releaseTag);
    const commitId = await getGitHubReleaseTagSha(org, repo, releaseTag);
    const releaseAssets = releaseData.assets;

    const metadata = {
      org,
      repo,
      releaseTag,
      commitId,
      collectedAt: new Date().toISOString(),
      assets: [],
    };

    for (const { name, platform, arch, chmod } of assets) {
      const releaseAsset = releaseAssets.find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (releaseAsset) {
        try {
          console.group(yellow(releaseAsset.name));
          await downloadAndExtractGitHubAsset(targetDirectory, releaseAsset, platform, arch, chmod);
        } finally {
          console.groupEnd();
        }
        metadata.assets.push({
          name: releaseAsset.name,
          platform,
          arch,
          chmod: !!chmod,
          updatedAt: releaseAsset.updated_at,
        });
      } else {
        console.warn(`Asset [${name}] was not found in GitHub release ${releaseData.html_url}`);
      }
    }

    await fs.writeJson(metaFile, metadata, { spaces: 2 });
    console.log(`Metadata written to ${metaFile}`);
    console.log(`All assets downloaded to: ${targetDirectory}`);
  } catch (error) {
    console.error("Error downloading the release:", error.message);
  }
}

export async function downloadAndExtractTarGz({ targetDirectory, url, sha256 }) {
  try {
    console.group(yellow(url));
    console.log(bold("Download:"), url, bold("To:"), targetDirectory);
    await fs.ensureDir(targetDirectory);

    // Download the tar.gz file
    const fileName = basename(new URL(url).pathname);
    const targetFile = join(targetDirectory, fileName);

    console.log("Downloading:", yellow(fileName));
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }
    const downloadSha256 = await streamResponseToFile(targetFile, response);

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

    // Extract the tar.gz file
    console.log(`Extracting to ${targetDirectory}`);
    tar.extract({
      f: targetFile,
      z: true,
      cwd: targetDirectory,
    });
  } catch (error) {
    console.error("Error downloading/extracting tar.gz:", error);
  } finally {
    console.groupEnd();
  }
}
