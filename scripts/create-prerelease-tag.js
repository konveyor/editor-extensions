#!/usr/bin/env node

/**
 * Creates a prerelease tag based on the current version in package.json
 *
 * Logic:
 * 1. Read version from package.json (e.g., 0.4.0)
 * 2. Calculate prerelease minor version: current_minor - 1 (e.g., 0.4.0 -> 0.3)
 * 3. Find latest tag for that major.minor (e.g., v0.3.5)
 * 4. Increment patch version (e.g., v0.3.6)
 * 5. Create and push the new tag
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Parse a version string into components
 * @param {string} version - Version string (e.g., "0.4.0" or "v0.4.0")
 * @returns {{major: number, minor: number, patch: number}}
 */
export function parseVersion(version) {
  const cleaned = version.replace(/^v/, "");
  const parts = cleaned.split(".");

  if (parts.length !== 3) {
    throw new Error(`Invalid version format: ${version}`);
  }

  return {
    major: parseInt(parts[0], 10),
    minor: parseInt(parts[1], 10),
    patch: parseInt(parts[2], 10),
  };
}

/**
 * Calculate the prerelease version minor from current version
 * @param {string} currentVersion - Current version from package.json (e.g., "0.4.0")
 * @returns {{major: number, minor: number}} - Prerelease version (e.g., {major: 0, minor: 3})
 */
export function calculatePrereleaseVersion(currentVersion) {
  const { major, minor } = parseVersion(currentVersion);

  if (minor === 0) {
    throw new Error("Cannot create prerelease when minor version is 0");
  }

  return {
    major,
    minor: minor - 1,
  };
}

/**
 * Get all tags from git
 * @returns {string[]} - Array of tag names
 */
export function getAllTags() {
  try {
    const output = execSync("git tag -l", { encoding: "utf8" });
    return output.trim().split("\n").filter(Boolean);
  } catch (error) {
    console.error("Error getting git tags:", error.message);
    return [];
  }
}

/**
 * Find the latest tag for a specific major.minor version
 * @param {number} major - Major version
 * @param {number} minor - Minor version
 * @param {string[]} tags - Array of all git tags
 * @returns {string|null} - Latest tag (e.g., "v0.3.5") or null if none found
 */
export function findLatestTagForVersion(major, minor, tags) {
  const prefix = `v${major}.${minor}.`;

  const matchingTags = tags
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => {
      try {
        const parsed = parseVersion(tag);
        return { tag, ...parsed };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((t) => t.major === major && t.minor === minor);

  if (matchingTags.length === 0) {
    return null;
  }

  // Sort by patch version descending
  matchingTags.sort((a, b) => b.patch - a.patch);

  return matchingTags[0].tag;
}

/**
 * Calculate the next tag version
 * @param {number} major - Major version
 * @param {number} minor - Minor version
 * @param {string[]} tags - Array of all git tags
 * @returns {string} - Next tag (e.g., "v0.3.6")
 */
export function calculateNextTag(major, minor, tags) {
  const latestTag = findLatestTagForVersion(major, minor, tags);

  if (!latestTag) {
    // No existing tags, start with .0
    return `v${major}.${minor}.0`;
  }

  const { patch } = parseVersion(latestTag);
  return `v${major}.${minor}.${patch + 1}`;
}

/**
 * Create and push a git tag
 * @param {string} tag - Tag name (e.g., "v0.3.6")
 * @param {boolean} dryRun - If true, only print what would be done
 */
export function createAndPushTag(tag, dryRun = false) {
  if (dryRun) {
    console.log(`[DRY RUN] Would create and push tag: ${tag}`);
    return;
  }

  try {
    console.log(`Creating tag: ${tag}`);
    execSync(`git tag ${tag}`, { stdio: "inherit" });

    console.log(`Pushing tag: ${tag}`);
    execSync(`git push origin ${tag}`, { stdio: "inherit" });

    console.log(`✓ Successfully created and pushed tag: ${tag}`);
  } catch (error) {
    console.error(`Error creating/pushing tag: ${error.message}`);
    throw error;
  }
}

/**
 * Main function
 */
export async function main(options = {}) {
  const { dryRun = false, packageJsonPath } = options;

  try {
    // Read package.json
    const pkgPath = packageJsonPath || join(dirname(__dirname), "package.json");
    const packageJson = JSON.parse(await readFile(pkgPath, "utf8"));
    const currentVersion = packageJson.version;

    console.log(`Current version from package.json: ${currentVersion}`);

    // Calculate prerelease version
    const { major, minor } = calculatePrereleaseVersion(currentVersion);
    console.log(`Prerelease version base: ${major}.${minor}`);

    // Get all tags
    const tags = getAllTags();
    console.log(`Found ${tags.length} existing tags`);

    // Calculate next tag
    const nextTag = calculateNextTag(major, minor, tags);
    console.log(`Next tag to create: ${nextTag}`);

    // Create and push tag
    createAndPushTag(nextTag, dryRun);

    return nextTag;
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  main({ dryRun });
}
