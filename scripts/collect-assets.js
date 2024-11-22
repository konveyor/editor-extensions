#! /usr/bin/env node
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  createReadStream,
  writeFileSync,
  readdirSync,
  renameSync,
} from "fs";
import { resolve as _resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { Extract } from "unzipper";
import { Readable } from "stream";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GITHUB_API = "https://api.github.com";
const REPOSITORY = "konveyor/kai";
const RELEASE_TAG = "v0.0.1";
const DOWNLOAD_DIR = _resolve(__dirname, "../downloaded_assets");
const META_FILE = _resolve(DOWNLOAD_DIR, "collect.json");

const ASSETS_TO_DOWNLOAD = [
  { name: "kai-rpc-server.linux-x86_64.zip", folder: "linux", platform: "linux" },
  { name: "kai-rpc-server.macos-arm64.zip", folder: "macos-arm", platform: "macos-arm" },
  { name: "kai-rpc-server.macos-x86_64.zip", folder: "macos-x86", platform: "macos-x86" },
  { name: "kai-rpc-server.windows-x86_64.zip", folder: "windows", platform: "windows" },
];

if (!existsSync(DOWNLOAD_DIR)) {
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

async function getReleaseMetadata() {
  const url = `${GITHUB_API}/repos/${REPOSITORY}/releases/tags/${RELEASE_TAG}`;
  console.log(`Fetching release metadata for tag: ${RELEASE_TAG}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch release metadata: ${response.statusText}`);
  }

  return await response.json();
}

async function downloadAndExtractAsset(asset, folder, platform) {
  const platformDir = join(DOWNLOAD_DIR, folder);
  const assetPath = join(platformDir, asset.name);

  if (!existsSync(platformDir)) {
    mkdirSync(platformDir, { recursive: true });
  }

  console.log(`Downloading asset: ${asset.name}`);
  const response = await fetch(asset.browser_download_url);
  if (!response.ok) {
    throw new Error(`Failed to download ${asset.name}: ${response.statusText}`);
  }

  const fileStream = createWriteStream(assetPath);
  await new Promise((resolve, reject) => {
    const reader = Readable.fromWeb(response.body);
    reader.pipe(fileStream);
    reader.on("error", reject);
    fileStream.on("finish", resolve);
  });

  console.log(`Extracting asset: ${asset.name} to ${platformDir}`);
  await createReadStream(assetPath)
    .pipe(Extract({ path: platformDir }))
    .promise();

  const extractedFiles = readdirSync(platformDir);
  extractedFiles.forEach((file) => {
    const oldPath = join(platformDir, file);
    const newPath = join(platformDir, `${platform}-${file}`);
    renameSync(oldPath, newPath);
  });

  console.log(`Extracted files for: ${asset.name}`);
}

try {
  const releaseData = await getReleaseMetadata();
  const commitId = await getReleaseTagSha();
  const assets = releaseData.assets;

  const metadata = {
    releaseTag: RELEASE_TAG,
    commitId,
    collectedAt: new Date().toISOString(),
    assets: [],
  };

  for (const { name, folder, platform } of ASSETS_TO_DOWNLOAD) {
    const asset = assets.find((a) => a.name === name);
    if (asset) {
      await downloadAndExtractAsset(asset, folder, platform);
      metadata.assets.push({
        name: asset.name,
        updatedAt: asset.updated_at,
        folder: folder,
        platform: platform,
      });
    } else {
      console.warn(`Asset not found: ${name}`);
    }
  }

  writeFileSync(META_FILE, JSON.stringify(metadata, null, 2));
  console.log(`Metadata written to ${META_FILE}`);
  console.log(`All assets downloaded to: ${DOWNLOAD_DIR}`);
} catch (error) {
  console.error("Error:", error.message);
}

async function getReleaseTagSha() {
  const url = `${GITHUB_API}/repos/${REPOSITORY}/commits/${RELEASE_TAG}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.sha",
    },
  });

  return await response.text();
}
