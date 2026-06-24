import { renderPrompt } from "../src/registry.js";
import { templateSources } from "../src/templates.js";
import { cases } from "./fixtures.js";

describe("prompt template byte-exact parity", () => {
  // The primary acceptance gate: every Handlebars template must reproduce the
  // verbatim pre-refactor string for the same inputs, exactly (byte-for-byte).
  it.each(cases.map((c) => [c.name, c] as const))("renders identical bytes: %s", (_name, c) => {
    const rendered = renderPrompt(c.id, c.context);
    expect(rendered).toBe(c.expected);
  });

  // Drift snapshots: snapshot the actual rendered template output (not the
  // oracle's expected string) so a future template wording change surfaces as an
  // explicit, reviewable snapshot update.
  it.each(cases.map((c) => [c.name, c] as const))("matches drift snapshot: %s", (_name, c) => {
    expect(renderPrompt(c.id, c.context)).toMatchSnapshot();
  });

  it("exercises every governed template id at least once", () => {
    const covered = new Set(cases.map((c) => c.id));
    const all = Object.keys(templateSources);
    const missing = all.filter((id) => !covered.has(id as never));
    expect(missing).toEqual([]);
  });
});
