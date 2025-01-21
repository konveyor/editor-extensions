import { Incident, RuleSet, sanitizeIncidents } from "@editor-extensions/shared";
import { Immutable } from "immer";

export const allIncidents = (ruleSets: Immutable<RuleSet[]>): Incident[] =>
  sanitizeIncidents(
    ruleSets.flatMap((r) => Object.values(r.violations ?? {})).flatMap((v) => v?.incidents ?? []),
  );
