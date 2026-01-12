#! /usr/bin/env node
import { writeJson } from "fs-extra/esm";
import { join } from "path";
import { cwdToProjectRoot, ensureDirs, parseCli } from "./_util.js";
import {
  downloadAndExtractGitHubReleaseSourceCode,
  downloadGitHubReleaseAssets,
  downloadWorkflowArtifactsAndExtractAssets,
} from "./_download.js";
import { unpackAssets } from "./_unpack.js";

const cli = parseCli(
  {
    org: "konveyor",
    repo: "kai",
    branch: "main",
    workflow: "build-and-push-binaries.yml",
    rulesetOrg: "konveyor",
    rulesetRepo: "rulesets",
    releaseTag: "v0.9.0-alpha.4",
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

// TODO(djzager): This is just to make it so the linter doesn't complain about the variables being unused
console.log("useWorkflow:", useWorkflow);
console.log("useRelease:", useRelease);
console.log("org:", org);
console.log("repo:", repo);
console.log("releaseTag:", releaseTag);
console.log("branch:", branch);
console.log("pr:", pr);
console.log("workflow:", workflow);

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

  // // If from a workflow, download the artifacts and unpack
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

      globs: ["kai-analyzer-rpc*"],
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
      releaseTag: cli.releaseTag,
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

  // Download analyzer-lsp-binaries from analyzer-lsp release
  useRelease &&
    (async () => ({
      id: "download analyzer-lsp-binaries release assets",
      meta: await downloadGitHubReleaseAssets({
        targetDirectory: join(DOWNLOAD_CACHE, "analyzer-provider-assets"),
        org,
        repo: "analyzer-lsp",
        releaseTag,
        bearerToken,

        assets: [
          { name: "analyzer-lsp-binaries.linux-amd64.zip" },
          { name: "analyzer-lsp-binaries.linux-arm64.zip" },
          { name: "analyzer-lsp-binaries.darwin-amd64.zip" },
          { name: "analyzer-lsp-binaries.darwin-arm64.zip" },
          { name: "analyzer-lsp-binaries.windows-amd64.zip" },
        ],
      }),
    })),

  // Download analyzer-lsp-binaries from analyzer-lsp workflow artifacts
  useWorkflow &&
    (async () => ({
      id: "download analyzer-lsp-binaries workflow artifacts",
      meta: await downloadWorkflowArtifactsAndExtractAssets({
        downloadDirectory: join(DOWNLOAD_CACHE, "analyzer-provider-artifacts"),
        targetDirectory: join(DOWNLOAD_CACHE, "analyzer-provider-assets"),
        org,
        repo: "analyzer-lsp",
        branch,
        pr,
        workflow: "pr-testing.yml",
        bearerToken,

        artifacts: [
          {
            name: "analyzer-lsp-binaries.linux-amd64.zip",
            contents: ["analyzer-lsp-binaries.*.zip"],
          },
          {
            name: "analyzer-lsp-binaries.linux-arm64.zip",
            contents: ["analyzer-lsp-binaries.*.zip"],
          },
          {
            name: "analyzer-lsp-binaries.darwin-amd64.zip",
            contents: ["analyzer-lsp-binaries.*.zip"],
          },
          {
            name: "analyzer-lsp-binaries.darwin-arm64.zip",
            contents: ["analyzer-lsp-binaries.*.zip"],
          },
          {
            name: "analyzer-lsp-binaries.windows-amd64.zip",
            contents: ["analyzer-lsp-binaries.*.zip"],
          },
        ],
      }),
    })),

  // Extract java-external-provider binaries to platform-specific directories (same as kai pattern)
  async () => ({
    id: "java-external-provider binaries",
    meta: await unpackAssets({
      title: "java-external-provider binary",
      sourceDirectory: join(DOWNLOAD_CACHE, "analyzer-provider-assets"),
      targetDirectory: ({ platform, arch }) =>
        join(DOWNLOAD_DIR, "java-external-provider", `${platform}-${arch}`),

      globs: ["java-external-provider*"],
      assets: [
        {
          name: "analyzer-lsp-binaries.linux-amd64.zip",
          platform: "linux",
          arch: "x64",
          chmod: true,
        },
        {
          name: "analyzer-lsp-binaries.linux-arm64.zip",
          platform: "linux",
          arch: "arm64",
          chmod: true,
        },
        {
          name: "analyzer-lsp-binaries.darwin-amd64.zip",
          platform: "darwin",
          arch: "x64",
          chmod: true,
        },
        {
          name: "analyzer-lsp-binaries.darwin-arm64.zip",
          platform: "darwin",
          arch: "arm64",
          chmod: true,
        },
        { name: "analyzer-lsp-binaries.windows-amd64.zip", platform: "win32", arch: "x64" },
      ],
    }),
  }),

  // Extract generic-external-provider binaries to platform-specific directories (same as kai pattern)
  async () => ({
    id: "generic-external-provider binaries",
    meta: await unpackAssets({
      title: "generic-external-provider binary",
      sourceDirectory: join(DOWNLOAD_CACHE, "analyzer-provider-assets"),
      targetDirectory: ({ platform, arch }) =>
        join(DOWNLOAD_DIR, "generic-external-provider", `${platform}-${arch}`),

      globs: ["generic-external-provider*"],
      assets: [
        {
          name: "analyzer-lsp-binaries.linux-amd64.zip",
          platform: "linux",
          arch: "x64",
          chmod: true,
        },
        {
          name: "analyzer-lsp-binaries.linux-arm64.zip",
          platform: "linux",
          arch: "arm64",
          chmod: true,
        },
        {
          name: "analyzer-lsp-binaries.darwin-amd64.zip",
          platform: "darwin",
          arch: "x64",
          chmod: true,
        },
        {
          name: "analyzer-lsp-binaries.darwin-arm64.zip",
          platform: "darwin",
          arch: "arm64",
          chmod: true,
        },
        { name: "analyzer-lsp-binaries.windows-amd64.zip", platform: "win32", arch: "x64" },
      ],
    }),
  }),

  // Extract golang-dependency-provider binaries to platform-specific directories (same as kai pattern)
  async () => ({
    id: "golang-dependency-provider binaries",
    meta: await unpackAssets({
      title: "golang-dependency-provider binary",
      sourceDirectory: join(DOWNLOAD_CACHE, "analyzer-provider-assets"),
      targetDirectory: ({ platform, arch }) =>
        join(DOWNLOAD_DIR, "golang-dependency-provider", `${platform}-${arch}`),

      globs: ["golang-dependency-provider*"],
      assets: [
        {
          name: "analyzer-lsp-binaries.linux-amd64.zip",
          platform: "linux",
          arch: "x64",
          chmod: true,
        },
        {
          name: "analyzer-lsp-binaries.linux-arm64.zip",
          platform: "linux",
          arch: "arm64",
          chmod: true,
        },
        {
          name: "analyzer-lsp-binaries.darwin-amd64.zip",
          platform: "darwin",
          arch: "x64",
          chmod: true,
        },
        {
          name: "analyzer-lsp-binaries.darwin-arm64.zip",
          platform: "darwin",
          arch: "arm64",
          chmod: true,
        },
        { name: "analyzer-lsp-binaries.windows-amd64.zip", platform: "win32", arch: "x64" },
      ],
    }),
  }),
];

// Run the queued actions
const meta = [];
try {
  for (const action of actions) {
    if (action && typeof action === "function") {
      const actionMeta = await action();
      meta.push(actionMeta);
    }
  }
  writeJson(join(DOWNLOAD_DIR, "collect-assets-meta.json"), { cwd, actions: meta }, { spaces: 2 });
} catch (error) {
  console.error("Asset collection failed:", error);
  process.exit(1);
}
