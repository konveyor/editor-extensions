#!/usr/bin/env node

/**
 * Tests for create-prerelease-tag.js
 *
 * Run with: node scripts/create-prerelease-tag.test.js
 */

import assert from "node:assert";
import {
  parseVersion,
  calculatePrereleaseVersion,
  findLatestTagForVersion,
  calculateNextTag,
} from "./create-prerelease-tag.js";

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

console.log("Running tests for create-prerelease-tag.js\n");

// Test parseVersion
test("parseVersion: parses version without v prefix", () => {
  const result = parseVersion("0.4.0");
  assert.deepStrictEqual(result, { major: 0, minor: 4, patch: 0 });
});

test("parseVersion: parses version with v prefix", () => {
  const result = parseVersion("v0.4.0");
  assert.deepStrictEqual(result, { major: 0, minor: 4, patch: 0 });
});

test("parseVersion: parses version with large numbers", () => {
  const result = parseVersion("v1.23.456");
  assert.deepStrictEqual(result, { major: 1, minor: 23, patch: 456 });
});

test("parseVersion: throws on invalid format", () => {
  assert.throws(() => parseVersion("0.4"), /Invalid version format/);
});

test("parseVersion: throws on invalid format with too many parts", () => {
  assert.throws(() => parseVersion("0.4.0.1"), /Invalid version format/);
});

// Test calculatePrereleaseVersion
test("calculatePrereleaseVersion: calculates from 0.4.0", () => {
  const result = calculatePrereleaseVersion("0.4.0");
  assert.deepStrictEqual(result, { major: 0, minor: 3 });
});

test("calculatePrereleaseVersion: calculates from 0.6.0", () => {
  const result = calculatePrereleaseVersion("0.6.0");
  assert.deepStrictEqual(result, { major: 0, minor: 5 });
});

test("calculatePrereleaseVersion: calculates from 1.2.0", () => {
  const result = calculatePrereleaseVersion("1.2.0");
  assert.deepStrictEqual(result, { major: 1, minor: 1 });
});

test("calculatePrereleaseVersion: throws when minor is 0", () => {
  assert.throws(
    () => calculatePrereleaseVersion("0.0.0"),
    /Cannot create prerelease when minor version is 0/,
  );
});

test("calculatePrereleaseVersion: throws when minor is 0 for v1", () => {
  assert.throws(
    () => calculatePrereleaseVersion("1.0.0"),
    /Cannot create prerelease when minor version is 0/,
  );
});

// Test findLatestTagForVersion
test("findLatestTagForVersion: finds latest tag", () => {
  const tags = ["v0.3.0", "v0.3.1", "v0.3.2", "v0.4.0"];
  const result = findLatestTagForVersion(0, 3, tags);
  assert.strictEqual(result, "v0.3.2");
});

test("findLatestTagForVersion: returns null when no tags match", () => {
  const tags = ["v0.2.0", "v0.4.0"];
  const result = findLatestTagForVersion(0, 3, tags);
  assert.strictEqual(result, null);
});

test("findLatestTagForVersion: handles empty tag list", () => {
  const tags = [];
  const result = findLatestTagForVersion(0, 3, tags);
  assert.strictEqual(result, null);
});

test("findLatestTagForVersion: ignores tags from different versions", () => {
  const tags = ["v0.3.0", "v0.3.1", "v0.4.0", "v0.5.10", "v1.3.0"];
  const result = findLatestTagForVersion(0, 3, tags);
  assert.strictEqual(result, "v0.3.1");
});

test("findLatestTagForVersion: handles unsorted tags", () => {
  const tags = ["v0.3.5", "v0.3.1", "v0.3.10", "v0.3.2"];
  const result = findLatestTagForVersion(0, 3, tags);
  assert.strictEqual(result, "v0.3.10");
});

test("findLatestTagForVersion: ignores invalid tags", () => {
  const tags = ["v0.3.1", "invalid", "v0.3.2", "v0.3.x"];
  const result = findLatestTagForVersion(0, 3, tags);
  assert.strictEqual(result, "v0.3.2");
});

// Test calculateNextTag
test("calculateNextTag: increments patch version", () => {
  const tags = ["v0.3.0", "v0.3.1", "v0.3.2"];
  const result = calculateNextTag(0, 3, tags);
  assert.strictEqual(result, "v0.3.3");
});

test("calculateNextTag: starts at .0 when no tags exist", () => {
  const tags = ["v0.2.0", "v0.4.0"];
  const result = calculateNextTag(0, 3, tags);
  assert.strictEqual(result, "v0.3.0");
});

test("calculateNextTag: handles empty tag list", () => {
  const tags = [];
  const result = calculateNextTag(0, 3, tags);
  assert.strictEqual(result, "v0.3.0");
});

test("calculateNextTag: handles single existing tag", () => {
  const tags = ["v0.3.0"];
  const result = calculateNextTag(0, 3, tags);
  assert.strictEqual(result, "v0.3.1");
});

test("calculateNextTag: handles large patch numbers", () => {
  const tags = ["v0.3.99"];
  const result = calculateNextTag(0, 3, tags);
  assert.strictEqual(result, "v0.3.100");
});

// Integration test scenarios
test("Integration: v0.4.0 -> v0.3.0 (first prerelease)", () => {
  const currentVersion = "0.4.0";
  const tags = ["v0.2.0", "v0.4.0"];

  const { major, minor } = calculatePrereleaseVersion(currentVersion);
  const nextTag = calculateNextTag(major, minor, tags);

  assert.strictEqual(nextTag, "v0.3.0");
});

test("Integration: v0.4.0 -> v0.3.3 (existing prereleases)", () => {
  const currentVersion = "0.4.0";
  const tags = ["v0.2.0", "v0.3.0", "v0.3.1", "v0.3.2", "v0.4.0"];

  const { major, minor } = calculatePrereleaseVersion(currentVersion);
  const nextTag = calculateNextTag(major, minor, tags);

  assert.strictEqual(nextTag, "v0.3.3");
});

test("Integration: v0.6.0 -> v0.5.0 (next cycle)", () => {
  const currentVersion = "0.6.0";
  const tags = ["v0.2.0", "v0.3.0", "v0.3.5", "v0.4.0", "v0.4.2"];

  const { major, minor } = calculatePrereleaseVersion(currentVersion);
  const nextTag = calculateNextTag(major, minor, tags);

  assert.strictEqual(nextTag, "v0.5.0");
});

test("Integration: v1.2.0 -> v1.1.0 (major version 1)", () => {
  const currentVersion = "1.2.0";
  const tags = ["v0.4.0", "v1.0.0"];

  const { major, minor } = calculatePrereleaseVersion(currentVersion);
  const nextTag = calculateNextTag(major, minor, tags);

  assert.strictEqual(nextTag, "v1.1.0");
});

console.log("\nAll tests completed!");
