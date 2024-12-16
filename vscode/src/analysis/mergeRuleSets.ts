import { RuleSet, Violation } from "@editor-extensions/shared";
import { Immutable } from "immer";
import { Uri } from "vscode";
export const mergeRuleSets = (
  draft: RuleSet[],
  received: RuleSet[],
  fileUris: Uri[],
): RuleSet[] => {
  // use the same path representation as in the response
  // which is file:///some/path/File.java
  const filePaths = fileUris.map((uri) => uri.toString());
  return mergeRuleSetsWithStringPaths(draft, received, filePaths);
};

export const mergeRuleSetsWithStringPaths = (
  draft: RuleSet[],
  received: RuleSet[],
  filePaths: string[],
): RuleSet[] => {
  if (draft.length === 0) {
    // there were no full analysis yet or it's results were deleted
    // nothing to merge - take the whole partial analysis response
    draft.push(...received);
    return draft;
  }
  // remove old incidents in the files included in the partial analysis
  draft
    .flatMap((it) => [...Object.values(it.violations ?? {})])
    .filter((v) => v.incidents?.some((incident) => filePaths.includes(incident.uri)))
    .forEach(
      (v) => (v.incidents = v.incidents.filter((incident) => !filePaths.includes(incident.uri))),
    );

  // filter out empty rule sets
  received
    .map((it): [string, [string, Violation][]] => [
      it.name ?? "",
      Object.entries(it.violations ?? {}),
    ])
    .map(([name, violations]): [string, [string, Violation][]] => [
      name,
      // reject incidents outside of requested scope
      violations.filter(
        ([, violation]) => violation.incidents?.filter((it) => filePaths.includes(it.uri))?.length,
      ),
    ])
    .filter(([, violations]) => violations.length)
    // remaining violations contain incidents
    .forEach(([name, violations]) => {
      const current = draft.find((r) => r.name === name);
      if (!current) {
        // console.error("Missing current", draft);
        return;
      }

      violations.forEach(([name, violation]) => {
        if (!current.violations) {
          current.violations = { [name]: violation };
          return;
        }

        if (!current.violations[name]) {
          current.violations[name] = violation;
          // console.error("Missing target name", name, violation);
          return;
        }

        if (!current.violations[name].incidents) {
          current.violations[name].incidents = violation.incidents;
          // console.error("Missing target incident", name, violation.incidents);
          return;
        }

        current.violations[name].incidents.push(...violation.incidents);
        // console.error("Pushed", current.violations[name].incidents, violation.incidents);
      });
    });

  return draft;
};

export const countIncidentsOnPaths = (ruleSets: Immutable<RuleSet[]>, filePaths: string[]) =>
  ruleSets
    .flatMap((r) => Object.values(r.violations ?? {}))
    .flatMap((v) => v?.incidents ?? [])
    .filter((it) => filePaths.includes(it.uri)).length;
