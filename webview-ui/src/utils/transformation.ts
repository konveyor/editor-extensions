import { EnhancedIncident, EnhancedViolation, Incident } from "@editor-extensions/shared";

export const sanitizeIncidents = (incidents: Incident[]): Incident[] =>
  // ensure basic properties are valid
  incidents
    .filter(
      (it) =>
        // allow empty messages (they will be grouped together)
        typeof it.message === "string" &&
        typeof it.uri === "string" &&
        // expect non-empty path in format file:///some/file.ext
        it.uri.startsWith("file://"),
    )
    .map((it) => ({
      ...it,
      // line numbers are optional - use first line as fallback
      // expect 1-based numbering (vscode.Position is zero-based)
      lineNumber: Number.isInteger(it.lineNumber) && it.lineNumber! > 0 ? it.lineNumber : 1,
    }));

export const groupIncidentsByMsg = (
  incidents: EnhancedIncident[],
): { [msg: string]: [string, EnhancedIncident][] } =>
  incidents
    .map((it): [string, string, EnhancedIncident] => [it.message, it.uri, it])
    .reduce(
      (acc, [msg, uri, incident]) => {
        if (!acc[msg]) {
          acc[msg] = [];
        }
        acc[msg].push([uri, incident]);
        return acc;
      },
      {} as { [msg: string]: [string, EnhancedIncident][] },
    );

export function enhanceIncidents(
  incidents: Incident[] | undefined,
  violation: EnhancedViolation | undefined,
): EnhancedIncident[] {
  if (!incidents || !violation) {
    return [];
  }

  return incidents.map((incident) => ({
    ...incident,
    violationId: violation.id,
    violationDescription: violation.description,
    rulesetName: violation.rulesetName,
    violationName: violation.violationName,
    uri: incident.uri,
    message: incident.message,
    severity: incident.severity,
  }));
}
