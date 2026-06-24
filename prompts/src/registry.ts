// Import the CJS compiler build directly rather than "handlebars": the package's
// Node entry registers `require.extensions` hooks that webpack (used to bundle
// vscode/core) warns about and that we never use. This entry is the full
// compiler (not runtime-only) in CJS, so it works under both esbuild and ts-jest.
import Handlebars from "handlebars/dist/cjs/handlebars.js";
import { partialSources, templateSources, type PromptId } from "./templates.js";

// A private Handlebars environment so our helpers/partials never leak into (or
// collide with) any other Handlebars usage in a consuming process.
const hb = Handlebars.create();

// Structural-only helpers. These express selection/iteration logic that lives in
// the template assets themselves — they intentionally contain NO prompt prose.
hb.registerHelper("lower", (value: unknown) => String(value ?? "").toLowerCase());
hb.registerHelper("eq", (a: unknown, b: unknown) => a === b);
hb.registerHelper("or", function (this: unknown, ...args: unknown[]) {
  // Handlebars passes an options object as the final argument.
  return args.slice(0, -1).some(Boolean);
});

for (const [name, source] of Object.entries(partialSources)) {
  hb.registerPartial(name, source);
}

const compiled = new Map<PromptId, Handlebars.TemplateDelegate>();

/** Render a governed Handlebars prompt template to its final string. */
export function renderPrompt(id: PromptId, context: Record<string, unknown> = {}): string {
  let template = compiled.get(id);
  if (!template) {
    const source = templateSources[id];
    if (source === undefined) {
      throw new Error(`Unknown prompt id: ${id}`);
    }
    // noEscape: prompts must reach the model verbatim (no HTML entity escaping).
    // ignoreStandalone: disable Handlebars' standalone-tag whitespace stripping so
    //   every newline in a template renders literally and block tags emit only
    //   their dynamic content — essential for byte-exact parity with the originals.
    template = hb.compile(source, { noEscape: true, ignoreStandalone: true });
    compiled.set(id, template);
  }
  return template(context);
}
