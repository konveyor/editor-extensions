#!/usr/bin/env node
// Prompt template governance checks (ISO 42001 A.5.2).
//
// Validates the versioned prompt template set under prompts/:
//   - every template/partial on disk is declared in prompts/manifest.yaml (and vice-versa)
//   - content checksums in the manifest match the files on disk (drift detection)
//   - every Handlebars template + partial parses (syntactic verification)
//   - declared variables actually appear in their template, every top-level
//     variable the template references is declared, and no leftover `${...}` JS
//     interpolation escaped into a template asset
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

// Helper names that are not variables (registry helpers + Handlebars built-ins).
const KNOWN_HELPERS = new Set([
  "lower",
  "eq",
  "or",
  "if",
  "unless",
  "each",
  "with",
  "lookup",
  "log",
]);

// Collect the top-level (root-context) variables a template references, so we can
// flag any that aren't declared in the manifest. Walks the Handlebars AST and
// skips: helper names, `@data` vars (@first/@last/...), `this`, `../` parent
// paths, and identifiers resolved inside an {{#each}}/{{#with}} block (those are
// properties of the iterated item, not template variables).
function collectReferencedVars(src) {
  const refs = new Set();

  const addPath = (node, ctxDepth) => {
    if (!node || node.type !== "PathExpression" || node.data || node.depth > 0) {
      return;
    }
    const first = node.parts[0];
    if (first && first !== "this" && ctxDepth === 0 && !KNOWN_HELPERS.has(first)) {
      refs.add(first);
    }
  };
  const walkExpr = (node, ctxDepth) => {
    if (!node) {
      return;
    }
    if (node.type === "PathExpression") {
      addPath(node, ctxDepth);
    } else if (node.type === "SubExpression") {
      node.params.forEach((p) => walkExpr(p, ctxDepth));
    }
  };
  const walkProgram = (program, ctxDepth) => {
    for (const node of program.body) {
      if (node.type === "MustacheStatement") {
        // `{{helper arg}}` -> path is a helper; `{{var}}` -> path is a variable.
        if (node.params.length > 0) {
          node.params.forEach((p) => walkExpr(p, ctxDepth));
        } else {
          addPath(node.path, ctxDepth);
        }
      } else if (node.type === "BlockStatement") {
        node.params.forEach((p) => walkExpr(p, ctxDepth));
        const helper = node.path.parts[0];
        const childDepth = helper === "each" || helper === "with" ? ctxDepth + 1 : ctxDepth;
        if (node.program) {
          walkProgram(node.program, childDepth);
        }
        if (node.inverse) {
          walkProgram(node.inverse, ctxDepth);
        }
      }
    }
  };

  walkProgram(Handlebars.parse(src), 0);
  return refs;
}

function check() {
  const manifest = loadManifest();
  const entries = allEntries(manifest);
  const problems = [];

  // The prompt-set version must stay in lockstep with the package version so
  // release metadata can't drift (see PROMPT_GOVERNANCE.md).
  const pkgVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
  if (manifest.version !== pkgVersion) {
    problems.push(
      `Prompt-set version (${manifest.version}) does not match the package version ` +
        `in package.json (${pkgVersion}). Keep them in lockstep.`,
    );
  }

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
  const partialIds = new Set((manifest.partials ?? []).map((p) => p.id));

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

    // Static partial references must resolve to a declared partial. (precompile
    // only checks syntax — a typo'd `{{> name}}` would otherwise pass.)
    for (const [, name] of src.matchAll(/{{~?>\s*([\w-]+)\s*~?}}/g)) {
      if (!partialIds.has(name)) {
        problems.push(`Unknown partial "${name}" referenced in ${entry.id} (${entry.path}).`);
      }
    }

    // Declared variables must actually be referenced inside a Handlebars tag
    // (`{{ ... }}`) — a substring match would pass on a plain-text mention.
    const declaredVars = new Set(entry.variables ?? []);
    const tags = src.match(/{{[^}]*}}/g) ?? [];
    for (const variable of declaredVars) {
      const token = new RegExp(`\\b${variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      if (!tags.some((tag) => token.test(tag))) {
        problems.push(
          `Declared variable "${variable}" is not referenced in a {{...}} tag in ${entry.id} (${entry.path}).`,
        );
      }
    }

    // ...and the reverse: every top-level variable the template references must be
    // declared. Catches a typo like `{{migrationHnt}}` that would otherwise render
    // empty and pass CI. (Skipped if parsing failed — already reported above.)
    let referenced;
    try {
      referenced = collectReferencedVars(src);
    } catch {
      referenced = new Set();
    }
    for (const ref of referenced) {
      if (!declaredVars.has(ref) && !partialIds.has(ref)) {
        problems.push(
          `Variable "${ref}" is used in ${entry.id} (${entry.path}) but not declared in manifest.yaml.`,
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
    let src;
    try {
      src = readFileSync(abs, "utf8");
    } catch (err) {
      console.error(
        `Cannot update checksum for ${entry.id}: ${entry.path} could not be read ` +
          `(${err.code ?? err.message}). Fix the manifest path or restore the file.`,
      );
      process.exit(1);
    }
    entry.checksum = sha256(src);
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
