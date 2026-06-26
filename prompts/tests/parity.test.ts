import { renderPrompt } from "../src/registry.js";
import { templateSources, type PromptId } from "../src/templates.js";
import { cases } from "./fixtures.js";

// This suite iterates heterogeneous cases with a wide `PromptId`, so it calls
// renderPrompt through a loosened signature. Per-prompt key checking is enforced
// at the real (typed) call sites in the consumers.
const renderAny = renderPrompt as (id: PromptId, context: Record<string, unknown>) => string;

describe("prompt template byte-exact parity", () => {
  // The primary acceptance gate: every Handlebars template must reproduce the
  // verbatim pre-refactor string for the same inputs, exactly (byte-for-byte).
  it.each(cases.map((c) => [c.name, c] as const))("renders identical bytes: %s", (_name, c) => {
    const rendered = renderAny(c.id, c.context);
    expect(rendered).toBe(c.expected);
  });

  // Drift snapshots: snapshot the actual rendered template output (not the
  // oracle's expected string) so a future template wording change surfaces as an
  // explicit, reviewable snapshot update.
  it.each(cases.map((c) => [c.name, c] as const))("matches drift snapshot: %s", (_name, c) => {
    expect(renderAny(c.id, c.context)).toMatchSnapshot();
  });

  it("exercises every governed template id at least once", () => {
    const covered = new Set(cases.map((c) => c.id));
    const all = Object.keys(templateSources);
    const missing = all.filter((id) => !covered.has(id as never));
    expect(missing).toEqual([]);
  });
});
