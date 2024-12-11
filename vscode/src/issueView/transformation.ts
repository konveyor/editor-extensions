import { Incident, RuleSet } from "@editor-extensions/shared";
import { Immutable } from "immer";

export const allIncidents = (ruleSets: Immutable<RuleSet[]>): Incident[] =>
  ruleSets
    .flatMap((r) => Object.values(r.violations ?? {}))
    .flatMap((v) => v?.incidents ?? [])
    // ensure basic properties are valid
    .filter(
      (it) =>
        // allow empty messages (they will be grouped together)
        typeof it.message === "string" &&
        typeof it.uri === "string" &&
        Number.isInteger(it.lineNumber) &&
        // expect non-empty path in format file:///some/file.ext
        it.uri &&
        // expect 1-based numbering (vscode.Position is zero-based)
        it.lineNumber! > 0,
    );
