import { RuleSet, Violation } from "@editor-extensions/shared";

export const mergeRuleSets = (
  draft: RuleSet[],
  received: RuleSet[],
  filePaths: string[],
): RuleSet[] => {
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
      violations.filter(([, violation]) => violation.incidents?.length),
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
