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

// The exact set of variables each prompt requires. Keys are enforced at the call
// site, so a typo (`programmingLangage`) or a missing/extra key is a compile-time
// error rather than a silently-empty render. Values are `unknown` because
// Handlebars stringifies whatever it is given.
type VarContext<K extends string> = { readonly [P in K]: unknown };

export interface PromptContexts {
  "agentic.analysis.fix-issue.system": VarContext<"programmingLanguage" | "migrationHint">;
  "agentic.analysis.fix-issue.human": VarContext<
    | "programmingLanguage"
    | "migrationHint"
    | "fileName"
    | "inputFileContent"
    | "inputIncidents"
    | "hints"
  >;
  "agentic.analysis.summarize-additional-info.system": VarContext<
    "programmingLanguage" | "migrationHint"
  >;
  "agentic.analysis.summarize-additional-info.human": VarContext<
    "migrationHint" | "inputAllModifiedFiles" | "inputAllReasoning" | "inputAllAdditionalInfo"
  >;
  "agentic.analysis.summarize-history.system": VarContext<"programmingLanguage" | "migrationHint">;
  "agentic.analysis.summarize-history.human": VarContext<"migrationHint" | "inputAllReasoning">;
  "agentic.diagnostics.plan-fixes.system": VarContext<"programmingLanguage" | "migrationHint">;
  "agentic.diagnostics.plan-fixes.human": VarContext<
    "agents" | "subAgents" | "plannerInputTasksUri" | "tasks" | "background"
  >;
  "agentic.diagnostics.fix-general.system": VarContext<"programmingLanguage" | "migrationHint">;
  "agentic.diagnostics.fix-general.human": VarContext<
    "inputInstructionsForGeneralFix" | "inputUrisForGeneralFix"
  >;
  "agentic.diagnostics.fix-java-deps.system": VarContext<"migrationHint">;
  "agentic.diagnostics.fix-java-deps.human": VarContext<
    "inputInstructionsForGeneralFix" | "inputUrisForGeneralFix"
  >;
  "agentic.tools.instructions": VarContext<"tools">;
  "single-shot.continue-quick-action": VarContext<
    | "extensionShortName"
    | "ruleset_name"
    | "ruleset_description"
    | "violation_name"
    | "violation_description"
    | "violation_category"
    | "message"
  >;
  "operational.model-health-check.system": Record<string, never>;
  "operational.model-health-check.human": Record<string, never>;
}

// Compile-time guard: every PromptId must have a context entry above, so this map
// can't drift out of sync with the template registry.
type _ContextsCoverAllPrompts = PromptId extends keyof PromptContexts ? true : never;
const _contextsComplete: _ContextsCoverAllPrompts = true;
void _contextsComplete;

/** Render a governed Handlebars prompt template to its final string. */
export function renderPrompt<K extends PromptId>(id: K, context: PromptContexts[K]): string {
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
