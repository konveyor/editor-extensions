import { EnhancedIncident, Incident, RuleSet } from "@editor-extensions/shared";
import { processIncidents } from "./analyzerResults";
import { ExtensionState } from "src/extensionState";
import { writeDataFile } from "./storage";
import { RULE_SET_DATA_FILE_PREFIX } from "../utilities";

export const loadRuleSets = async (state: ExtensionState, receivedRuleSets: RuleSet[]) => {
  await writeDataFile(receivedRuleSets, RULE_SET_DATA_FILE_PREFIX);
  const enhancedIncidents = enhanceIncidentsFromRuleSets(receivedRuleSets);

  state.mutateData((draft) => {
    draft.ruleSets = receivedRuleSets;
    draft.enhancedIncidents = enhancedIncidents;
  });
  const diagnosticTuples = processIncidents(enhancedIncidents);
  state.diagnosticCollection.clear();
  state.diagnosticCollection.set(diagnosticTuples);
};

export const cleanRuleSets = (state: ExtensionState) => {
  state.diagnosticCollection.clear();
  state.mutateData((draft) => {
    draft.ruleSets = [];
  });
};

function enhanceIncidentsFromRuleSets(ruleSets: RuleSet[]): EnhancedIncident[] {
  const seen = new Set<string>();
  const firstProfileName = ruleSets[0]?.activeProfileName;

  return ruleSets.flatMap((ruleSet) =>
    Object.entries(ruleSet.violations || {}).flatMap(([violationId, violation]) =>
      violation.incidents
        .filter((incident: Incident) => {
          // Validate profile name consistency
          if (ruleSet.activeProfileName !== firstProfileName) {
            throw new Error(
              `Found RuleSet with different activeProfileName. Expected "${firstProfileName}" but found "${ruleSet.activeProfileName}"`,
            );
          }

          // Create a unique key from the violation ID, URI, and line number
          // This primarily protects us from duplicate incidents in the same
          // file when the line number is undefined, but it also serves as a
          // general rule if we have seen this particular violation at this
          // location before, it is a duplicate
          const key = `${violationId}:${incident.uri}:${incident.lineNumber}`;
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        })
        .map((incident: Incident) => ({
          ...incident,
          ruleset_name: ruleSet.name,
          ruleset_description: ruleSet.description,
          violation_name: violationId,
          violation_description: violation.description,
          violation_category: violation.category,
          violation_labels: violation.labels,
          violationId,
          uri: incident.uri,
          message: incident.message,
          activeProfileName: ruleSet.activeProfileName,
        })),
    ),
  );
}
