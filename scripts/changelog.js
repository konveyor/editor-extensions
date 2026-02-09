#!/usr/bin/env node
/**
 * Changelog fragment management script.
 *
 * Subcommands:
 *   validate                          Validate that fragments exist and are well-formed
 *   create <name> <kind>              Create a new changelog fragment file
 *   assemble <version>                Assemble fragments into per-extension CHANGELOG.md files
 *
 * Options:
 *   --draft                           Assemble as "Unreleased" without deleting fragments
 *   --extension <ext>                 Target a specific extension (for create/assemble)
 *   --output <file>                   Write to a specific file instead of extension CHANGELOG.md
 *
 * Fragments live in changes/unreleased/ and target one or more extensions via an optional
 * `extensions` field. If omitted, the fragment defaults to the core extension only.
 */

import { readdir, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import yaml from "js-yaml";

// --- Configuration ---

const FRAGMENTS_DIR = "changes/unreleased";

const EXTENSIONS = {
  core: "vscode/core/CHANGELOG.md",
  java: "vscode/java/CHANGELOG.md",
  javascript: "vscode/javascript/CHANGELOG.md",
  go: "vscode/go/CHANGELOG.md",
  csharp: "vscode/csharp/CHANGELOG.md",
  konveyor: "vscode/konveyor/CHANGELOG.md",
};

const VALID_EXTENSIONS = Object.keys(EXTENSIONS);

const VALID_KINDS = ["breaking", "feature", "enhancement", "bugfix", "deprecation"];

const KIND_HEADINGS = {
  breaking: "Breaking Changes",
  feature: "New Features",
  enhancement: "Enhancements",
  bugfix: "Bug Fixes",
  deprecation: "Deprecations",
};

// --- Fragment reading ---

async function listFragmentFiles() {
  if (!existsSync(FRAGMENTS_DIR)) {
    return [];
  }
  const files = await readdir(FRAGMENTS_DIR);
  return files.filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
}

async function readFragments() {
  const files = await listFragmentFiles();
  const fragments = [];
  const errors = [];

  for (const file of files) {
    const filepath = join(FRAGMENTS_DIR, file);
    const content = await readFile(filepath, "utf8");
    let parsed;
    try {
      parsed = yaml.load(content);
    } catch (e) {
      errors.push(`${file}: invalid YAML - ${e.message}`);
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      errors.push(`${file}: fragment must be a YAML object`);
      continue;
    }
    if (!VALID_KINDS.includes(parsed.kind)) {
      errors.push(
        `${file}: invalid kind "${parsed.kind}" (must be one of: ${VALID_KINDS.join(", ")})`,
      );
    }
    if (
      !parsed.description ||
      typeof parsed.description !== "string" ||
      !parsed.description.trim()
    ) {
      errors.push(`${file}: description is required and must be non-empty`);
    }

    // Validate extensions field if present
    if (parsed.extensions !== undefined) {
      if (!Array.isArray(parsed.extensions) || parsed.extensions.length === 0) {
        errors.push(`${file}: extensions must be a non-empty array (or omit to default to core)`);
      } else {
        for (const ext of parsed.extensions) {
          if (!VALID_EXTENSIONS.includes(ext)) {
            errors.push(
              `${file}: invalid extension "${ext}" (must be one of: ${VALID_EXTENSIONS.join(", ")})`,
            );
          }
        }
      }
    }

    fragments.push({ ...parsed, file });
  }

  return { fragments, errors };
}

/**
 * Returns the list of extensions a fragment targets.
 * If no `extensions` field, defaults to ["core"].
 */
function getFragmentExtensions(fragment) {
  if (Array.isArray(fragment.extensions) && fragment.extensions.length > 0) {
    return fragment.extensions;
  }
  return ["core"];
}

// --- Subcommands ---

async function validate() {
  const files = await listFragmentFiles();
  if (files.length === 0) {
    console.error(
      `No changelog fragments found in ${FRAGMENTS_DIR}/.\n` +
        `Add a fragment file for your PR. See changes/template.yaml for the format.\n` +
        `Example: node scripts/changelog.js create 1234-my-change bugfix`,
    );
    process.exit(1);
  }

  const { fragments, errors } = await readFragments();
  if (errors.length > 0) {
    console.error("Changelog fragment validation errors:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  console.log(`Validated ${fragments.length} changelog fragment(s).`);
}

async function create(name, kind, extensions) {
  if (!name || !kind) {
    console.error("Usage: changelog.js create <name> <kind> [--extension <ext> ...]");
    console.error(`  name: filename without extension (e.g. 1234-fix-auth)`);
    console.error(`  kind: one of ${VALID_KINDS.join(", ")}`);
    console.error(`  --extension: one of ${VALID_EXTENSIONS.join(", ")} (default: core)`);
    process.exit(1);
  }
  if (!VALID_KINDS.includes(kind)) {
    console.error(`Invalid kind "${kind}". Must be one of: ${VALID_KINDS.join(", ")}`);
    process.exit(1);
  }
  for (const ext of extensions) {
    if (!VALID_EXTENSIONS.includes(ext)) {
      console.error(`Invalid extension "${ext}". Must be one of: ${VALID_EXTENSIONS.join(", ")}`);
      process.exit(1);
    }
  }

  await mkdir(FRAGMENTS_DIR, { recursive: true });
  const filepath = join(FRAGMENTS_DIR, `${name}.yaml`);
  if (existsSync(filepath)) {
    console.error(`Fragment already exists: ${filepath}`);
    process.exit(1);
  }

  let content = `kind: ${kind}\ndescription: >\n  TODO: Describe your change here.\n`;
  if (extensions.length > 0) {
    content += `extensions:\n`;
    for (const ext of extensions) {
      content += `  - ${ext}\n`;
    }
  }

  await writeFile(filepath, content);
  console.log(`Created ${filepath}`);
}

/**
 * Build a markdown section from a list of fragments.
 */
function buildSection(fragments, heading) {
  const grouped = {};
  for (const kind of VALID_KINDS) {
    const items = fragments.filter((f) => f.kind === kind);
    if (items.length > 0) {
      grouped[kind] = items;
    }
  }

  let section = `## ${heading}\n\n`;
  for (const [kind, items] of Object.entries(grouped)) {
    section += `### ${KIND_HEADINGS[kind]}\n\n`;
    for (const item of items) {
      let desc = item.description.trim();
      if (!/[.!?]$/.test(desc)) {
        desc += ".";
      }
      const prMatch = item.file.match(/^(\d+)-/);
      if (prMatch) {
        desc += ` ([#${prMatch[1]}](https://github.com/konveyor/editor-extensions/pull/${prMatch[1]}))`;
      }
      section += `- ${desc}\n`;
    }
    section += "\n";
  }

  return section;
}

/**
 * Prepend a release section to a changelog file.
 */
async function prependToChangelog(targetFile, section) {
  let changelog;
  if (existsSync(targetFile)) {
    changelog = await readFile(targetFile, "utf8");
    const preambleMatch = changelog.match(/^([\s\S]*?)(?=\n## |\s*$)/);
    if (preambleMatch) {
      const insertPos = preambleMatch[0].length;
      changelog = changelog.slice(0, insertPos) + "\n\n" + section + changelog.slice(insertPos);
    } else {
      changelog = `# Changelog\n\n${section}${changelog}`;
    }
  } else {
    changelog = `# Changelog\n\n${section}`;
  }

  await writeFile(targetFile, changelog);
}

async function assemble(version, { draft = false, output = null, extension = null } = {}) {
  if (!version && !draft) {
    console.error(
      "Usage: changelog.js assemble <version> [--draft] [--extension <ext>] [--output <file>]",
    );
    process.exit(1);
  }

  const { fragments, errors } = await readFragments();
  if (errors.length > 0) {
    console.error("Cannot assemble — fragment validation errors:");
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  if (fragments.length === 0) {
    console.log("No fragments to assemble.");
    return;
  }

  const date = new Date().toISOString().split("T")[0];
  const heading = draft ? "Unreleased" : `[${version}] - ${date}`;

  // Determine which extensions to assemble
  const targetExtensions = extension ? [extension] : VALID_EXTENSIONS;
  let assembled = 0;

  for (const ext of targetExtensions) {
    const changelogFile = output || EXTENSIONS[ext];

    // Filter fragments for this extension
    const extFragments = fragments.filter((f) => getFragmentExtensions(f).includes(ext));

    if (extFragments.length === 0) {
      continue;
    }

    const section = buildSection(extFragments, heading);
    await prependToChangelog(changelogFile, section);
    assembled += extFragments.length;
    console.log(`  ${ext}: ${extFragments.length} fragment(s) → ${changelogFile}`);
  }

  // Delete consumed fragments (all of them, not per-extension)
  if (!draft && assembled > 0) {
    for (const f of fragments) {
      await rm(join(FRAGMENTS_DIR, f.file));
    }
  }

  const mode = draft ? "draft" : version;
  console.log(`\nAssembled ${fragments.length} fragment(s) (${mode}).`);
}

// --- CLI dispatch ---

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && (i === 0 || !["--extension", "--output"].includes(argv[i - 1])),
);
const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));

function getFlagValue(flag) {
  const idx = argv.indexOf(flag);
  return idx !== -1 && idx + 1 < argv.length ? argv[idx + 1] : null;
}

function getFlagValues(flag) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && i + 1 < argv.length) {
      values.push(argv[i + 1]);
    }
  }
  return values;
}

switch (cmd) {
  case "validate":
    await validate();
    break;
  case "create":
    await create(positional[1], positional[2], getFlagValues("--extension"));
    break;
  case "assemble":
    await assemble(positional[1], {
      draft: flags.has("--draft"),
      output: getFlagValue("--output"),
      extension: getFlagValue("--extension"),
    });
    break;
  default:
    console.log("Usage: node scripts/changelog.js <command>");
    console.log("");
    console.log("Commands:");
    console.log(
      "  validate                                    Check that fragments exist and are well-formed",
    );
    console.log("  create <name> <kind> [--extension <ext>]    Create a new fragment file");
    console.log(
      "  assemble <version>                          Assemble fragments into per-extension CHANGELOGs",
    );
    console.log(
      "  assemble --draft                            Assemble as 'Unreleased' without deleting fragments",
    );
    console.log("  assemble <ver> --extension <ext>             Assemble for a single extension");
    console.log("");
    console.log(`Valid kinds: ${VALID_KINDS.join(", ")}`);
    console.log(`Valid extensions: ${VALID_EXTENSIONS.join(", ")}`);
    break;
}
