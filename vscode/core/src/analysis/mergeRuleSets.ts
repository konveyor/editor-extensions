import { RuleSet } from "@editor-extensions/shared";
import { Immutable } from "immer";

export const countIncidentsOnPaths = (ruleSets: Immutable<RuleSet[]>, filePaths: string[]) =>
  ruleSets
    .flatMap((r) => Object.values(r.violations ?? {}))
    .flatMap((v) => v?.incidents ?? [])
    .filter((it) => filePaths.includes(it.uri)).length;
