#!/usr/bin/env node
// Prompt template governance checks (ISO 42001 A.5.2).
//
// Validates the versioned prompt template set under prompts/:
//   - every template/partial on disk is declared in prompts/manifest.yaml (and vice-versa)
//   - content checksums in the manifest match the files on disk (drift detection)
//   - every Handlebars template + partial parses (syntactic verification)
//   - declared variables actually appear in their template, and no leftover
//     `${...}` JS interpolation escaped into a template asset
//
// Usage:
//   node scripts/prompts-version.js check     # CI gate (exits non-zero on any problem)
//   node scripts/prompts-version.js update    # recompute + write checksums (dev convenience)

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import Handlebars from "handlebars";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROMPTS_DIR = join(ROOT, "prompts");
const TEMPLATES_DIR = join(PROMPTS_DIR, "templates");
const MANIFEST_PATH = join(PROMPTS_DIR, "manifest.yaml");

function sha256(text) {
  return "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (name.endsWith(".hbs")) {
      out.push(full);
    }
  }
  return out;
}

function relPath(full) {
  return relative(PROMPTS_DIR, full).split("\\").join("/");
}

function loadManifest() {
  return yaml.load(readFileSync(MANIFEST_PATH, "utf8"));
}

function allEntries(manifest) {
  return [...(manifest.templates ?? []), ...(manifest.partials ?? [])];
}

function check() {
  const manifest = loadManifest();
  const entries = allEntries(manifest);
  const problems = [];

  const onDisk = new Set(walk(TEMPLATES_DIR).map(relPath));
  const declared = new Set(entries.map((e) => e.path));

  for (const p of onDisk) {
    if (!declared.has(p)) {
      problems.push(`Template on disk is not declared in manifest.yaml: ${p}`);
    }
  }
  for (const p of declared) {
    if (!onDisk.has(p)) {
      problems.push(`Manifest declares a template that does not exist on disk: ${p}`);
    }
  }

  // Register partials so template precompilation can resolve them.
  for (const partial of manifest.partials ?? []) {
    try {
      const src = readFileSync(join(PROMPTS_DIR, partial.path), "utf8");
      Handlebars.registerPartial(partial.id, src);
    } catch {
      /* missing-file problem already reported above */
    }
  }

  for (const entry of entries) {
    const abs = join(PROMPTS_DIR, entry.path);
    let src;
    try {
      src = readFileSync(abs, "utf8");
    } catch {
      continue; // missing-file already reported
    }

    const actual = sha256(src);
    if (entry.checksum !== actual) {
      problems.push(
        `Checksum drift for ${entry.id} (${entry.path}). ` +
          `Manifest: ${entry.checksum || "<none>"}, actual: ${actual}. ` +
          `Run "node scripts/prompts-version.js update" and review the change.`,
      );
    }

    // Syntactic verification: the template must parse.
    try {
      Handlebars.precompile(src);
    } catch (err) {
      problems.push(`Handlebars parse error in ${entry.id} (${entry.path}): ${err.message}`);
    }

    // No leftover JS interpolation should escape into a governed asset.
    if (src.includes("${")) {
      problems.push(`Leftover \${...} JS interpolation found in ${entry.id} (${entry.path}).`);
    }

    // Declared variables must actually be referenced by the template.
    for (const variable of entry.variables ?? []) {
      if (!src.includes(variable)) {
        problems.push(
          `Declared variable "${variable}" is not referenced in ${entry.id} (${entry.path}).`,
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error("Prompt template validation FAILED:\n");
    for (const p of problems) {
      console.error("  - " + p);
    }
    console.error(`\n${problems.length} problem(s) found.`);
    process.exit(1);
  }

  console.log(
    `Prompt template validation passed. ` +
      `version=${manifest.version}, templates=${(manifest.templates ?? []).length}, ` +
      `partials=${(manifest.partials ?? []).length}.`,
  );
}

function update() {
  const manifest = loadManifest();
  for (const entry of allEntries(manifest)) {
    const abs = join(PROMPTS_DIR, entry.path);
    entry.checksum = sha256(readFileSync(abs, "utf8"));
  }
  writeFileSync(
    MANIFEST_PATH,
    "# Prompt template manifest — governed under ISO 42001 A.5.2.\n" +
      "# Checksums are maintained by scripts/prompts-version.js; do not edit by hand.\n" +
      yaml.dump(manifest, { lineWidth: 1000, quotingType: '"' }),
    "utf8",
  );
  console.log(`Updated checksums for ${allEntries(manifest).length} entries.`);
}

const cmd = process.argv[2];
if (cmd === "check") {
  check();
} else if (cmd === "update") {
  update();
} else {
  console.error("Usage: node scripts/prompts-version.js <check|update>");
  process.exit(2);
}
