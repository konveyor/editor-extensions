#! /usr/bin/env node
import { writeJson } from "fs-extra/esm";
import { join } from "path";
import { cwdToProjectRoot, ensureDirs, parseCli } from "./_util.js";
import {
  downloadAndExtractGitHubReleaseSourceCode,
  downloadAndExtractTarGz,
  downloadGitHubReleaseAssets,
  downloadWorkflowArtifactsAndExtractAssets,
} from "./_download.js";
import { unpackAssets } from "./_unpack.js";

const cli = parseCli(
  {
    org: "konveyor",
    repo: "kai",
    releaseTag: "v0.1.0",
    branch: "main",
    workflow: "build-and-push-binaries.yml",
    rulesetOrg: "konveyor",
    rulesetRepo: "rulesets",
    rulesetReleaseTag: "v0.6.1",
  },
  "release",
);
console.log("collect-assets configuration:", cli);

// Run in project root
const cwd = cwdToProjectRoot();

// Setup download target
const [DOWNLOAD_CACHE, DOWNLOAD_DIR] = await ensureDirs(["downloaded_cache", "downloaded_assets"]);
const { useWorkflow, useRelease, org, repo, releaseTag, branch, pr, workflow } = cli;
const bearerToken = process.env.GITHUB_TOKEN ?? undefined;

const actions = [
  // If from a release, download the release asset zips
  useRelease &&
    (async () => ({
      id: "download release assets",
      meta: await downloadGitHubReleaseAssets({
        targetDirectory: join(DOWNLOAD_CACHE, "assets"),
        org,
        repo,
        releaseTag,
        bearerToken,

        assets: [
          { name: "kai-rpc-server.linux-x86_64.zip" },
          { name: "kai-rpc-server.linux-aarch64.zip" },
          { name: "kai-rpc-server.macos-x86_64.zip" },
          { name: "kai-rpc-server.macos-arm64.zip" },
          { name: "kai-rpc-server.windows-X64.zip" },
        ],
      }),
    })),

  // If from a workflow, download the artifacts and unpack
  useWorkflow &&
    (async () => ({
      id: "download workflow artifacts and extract assets",
      meta: await downloadWorkflowArtifactsAndExtractAssets({
        downloadDirectory: join(DOWNLOAD_CACHE, "artifacts"),
        targetDirectory: join(DOWNLOAD_CACHE, "assets"),
        org,
        repo,
        branch,
        pr,
        workflow,
        bearerToken,

        artifacts: [
          { name: "kai-rpc-server.linux-aarch64.zip", contents: ["kai-rpc-server.*.zip"] },
          { name: "kai-rpc-server.linux-x86_64.zip", contents: ["kai-rpc-server.*.zip"] },
          { name: "kai-rpc-server.macos-arm64.zip", contents: ["kai-rpc-server.*.zip"] },
          { name: "kai-rpc-server.macos-x86_64.zip", contents: ["kai-rpc-server.*.zip"] },
          { name: "kai-rpc-server.windows-X64.zip", contents: ["kai-rpc-server.*.zip"] },
        ],
      }),
    })),

  // Extract Kai binaries from the downloaded workflows artifact or release assets
  async () => ({
    id: "kai binaries",
    meta: await unpackAssets({
      title: "kai binary",
      sourceDirectory: join(DOWNLOAD_CACHE, "assets"),
      targetDirectory: ({ platform, arch }) => join(DOWNLOAD_DIR, "kai", `${platform}-${arch}`),

      globs: ["kai-analyzer-rpc*", "kai-rpc-server*"],
      assets: [
        { name: "kai-rpc-server.linux-x86_64.zip", platform: "linux", arch: "x64", chmod: true },
        { name: "kai-rpc-server.linux-aarch64.zip", platform: "linux", arch: "arm64", chmod: true },
        { name: "kai-rpc-server.macos-x86_64.zip", platform: "darwin", arch: "x64", chmod: true },
        { name: "kai-rpc-server.macos-arm64.zip", platform: "darwin", arch: "arm64", chmod: true },
        { name: "kai-rpc-server.windows-X64.zip", platform: "win32", arch: "x64" },
      ],
    }),
  }),

  // Extract opensource-labels-file from the linux-x64_64 downloaded workflow artifact or release asset
  async () => ({
    id: "opensource-labels-file",
    meta: await unpackAssets({
      title: "opensource-labels-file",
      sourceDirectory: join(DOWNLOAD_CACHE, "assets"),
      targetDirectory: () => join(DOWNLOAD_DIR, "opensource-labels-file"),

      globs: ["maven.default.index"],
      assets: [{ name: "kai-rpc-server.linux-x86_64.zip" }],
    }),
  }),

  // Download and extract seed rulesets from a rulesets repo release
  async () => ({
    id: "seed rulesets",
    meta: await downloadAndExtractGitHubReleaseSourceCode({
      downloadDirectory: join(DOWNLOAD_CACHE, "sources"),
      targetDirectory: join(DOWNLOAD_DIR, "rulesets"),

      org: cli.rulesetOrg,
      repo: cli.rulesetRepo,
      releaseTag: cli.rulesetReleaseTag,
      bearerToken,

      context: "{{root}}/default/generated",
      globs: ["**/*"],
    }),
  }),

  // Extract jdt.ls bundles from the linux-x64_64 downloaded workflow artifact or release asset
  async () => ({
    id: "jdt.ls bundles",
    meta: await unpackAssets({
      title: "jdt.ls bundles",
      sourceDirectory: join(DOWNLOAD_CACHE, "assets"),
      targetDirectory: () => join(DOWNLOAD_DIR, "jdtls-bundles"),

      globs: ["*.jar"],
      assets: [{ name: "kai-rpc-server.linux-x86_64.zip" }],
    }),
  }),

  // Download and extract `jdt.ls`
  // Base release url: https://download.eclipse.org/jdtls/milestones/1.38.0/
  async () => ({
    id: "jdt.ls",
    meta: await downloadAndExtractTarGz({
      downloadDirectory: join(DOWNLOAD_CACHE, "assets"),
      targetDirectory: join(DOWNLOAD_DIR, "jdt.ls-1.38.0"),
      url: "https://download.eclipse.org/jdtls/milestones/1.38.0/jdt-language-server-1.38.0-202408011337.tar.gz",
      sha256: "ba697788a19f2ba57b16302aba6b343c649928c95f76b0d170494ac12d17ac78",
    }),
  }),
];

// Run the queued actions
const meta = [];
for (const action of actions) {
  if (action && typeof action === "function") {
    const actionMeta = await action();
    meta.push(actionMeta);
  }
}
writeJson(join(DOWNLOAD_DIR, "collect-assets-meta.json"), { cwd, actions: meta }, { spaces: 2 });
