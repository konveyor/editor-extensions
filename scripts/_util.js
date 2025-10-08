import process from "node:process";
import path from "node:path";
import fs from "fs-extra";
import { parseArgs } from "node:util";

import { italic, gray } from "colorette";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";

/**
 * Change the process's cwd to the project root (as per the normal location of this file).
 */
export function cwdToProjectRoot() {
  const getProjectRoot = path.resolve(path.dirname(process.argv[1]), "..");
  process.chdir(getProjectRoot);
  console.log(gray(italic(`working from: ${getProjectRoot}`)));
  return getProjectRoot;
}

/**
 * `chmod` a file or directory to add owner execute permissions.  Same as
 * running `chmod o+x {path}`.
 *
 * @param {string} path File or directory to chmod
 */
export function chmodOwnerPlusX(path) {
  const { mode = fs.constants.S_IRUSR } = fs.statSync(path);
  fs.chmodSync(path, mode | fs.constants.S_IXUSR);
}

export async function isFile(path) {
  return (await fs.pathExists(path)) && (await fs.stat(path)).isFile;
}

export async function isDirectory(path) {
  return (await fs.pathExists(path)) && (await fs.stat(path)).isDirectory;
}

export function relativeToCwd(pathTo) {
  return path.relative(path.resolve("."), path.resolve(pathTo));
}

export async function fileSha256(path) {
  if (!isFile(path)) {
    return "";
  }

  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * @param {string[]} directories
 */
export async function ensureDirs(directories) {
  return await Promise.all(
    directories.map(async (dir) => {
      const fullPath = path.resolve(dir);
      await fs.ensureDir(fullPath);
      return fullPath;
    }),
  );
}

export function parseCli(
  { org, repo, releaseTag, workflow, branch, rulesetOrg, rulesetRepo, rulesetReleaseTag },
  useDefault = "release",
) {
  const { values } = parseArgs({
    options: {
      "use-release": {
        type: "boolean",
        short: "R",
        default: useDefault === "release",
      },
      // TODO: Would a better name be "use-latest"?
      "use-workflow-artifacts": {
        type: "boolean",
        short: "W",
        default: useDefault === "workflow",
      },
      org: {
        type: "string",
        short: "o",
        default: org,
      },
      repo: {
        type: "string",
        short: "r",
        default: repo,
      },
      "release-tag": {
        type: "string",
        short: "R",
        default: releaseTag,
      },
      workflow: {
        type: "string",
        short: "w",
        default: workflow,
      },
      branch: {
        type: "string",
        short: "b",
        default: branch,
      },
      pr: {
        type: "string",
        short: "p",
        default: undefined,
      },
      "ruleset-org": {
        type: "string",
        default: rulesetOrg,
      },
      "ruleset-repo": {
        type: "string",
        default: rulesetRepo,
      },
      "ruleset-release-tag": {
        type: "string",
        default: rulesetReleaseTag,
      },
    },
    allowNegative: true,
  });

  const ruleset = {
    rulesetOrg: values["ruleset-org"],
    rulesetRepo: values["ruleset-repo"],
    releaseTag: values["release-tag"],
  };

  if (values["use-workflow-artifacts"] && values.workflow && values.pr) {
    return {
      useWorkflow: true,
      usePr: true,
      org: values.org,
      repo: values.repo,
      workflow: values.workflow,
      pr: values.pr,
      ...ruleset,
    };
  }
  if (values["use-workflow-artifacts"] && values.workflow && values.branch) {
    return {
      useWorkflow: true,
      org: values.org,
      repo: values.repo,
      workflow: values.workflow,
      branch: values.branch,
      ...ruleset,
    };
  }
  if (values["use-release"] && values["release-tag"]) {
    return {
      useRelease: true,
      org: values.org,
      repo: values.repo,
      releaseTag: values["release-tag"],
      ...ruleset,
    };
  }
  return {
    org: values.org,
    repo: values.repo,
    ...ruleset,
  };
}
