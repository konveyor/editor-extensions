import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";
import { templateSources } from "../src/templates.js";

// The prompt id lives in three hand-maintained places (manifest, registry map,
// filename). This locks the manifest's ids to the registry keys so a typo in
// either surfaces instead of silently mis-declaring a governed prompt.
describe("manifest", () => {
  const manifest = yaml.load(readFileSync(resolve(process.cwd(), "manifest.yaml"), "utf8")) as {
    templates: Array<{ id: string }>;
  };

  it("declares exactly the templates the registry exposes", () => {
    const manifestIds = manifest.templates.map((t) => t.id).sort();
    const registryIds = Object.keys(templateSources).sort();
    expect(manifestIds).toEqual(registryIds);
  });
});
