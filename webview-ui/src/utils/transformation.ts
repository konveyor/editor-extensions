import { Incident } from "@editor-extensions/shared";

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
  incidents: Incident[],
): { [msg: string]: [string, Incident][] } =>
  incidents
    .map((it): [string, string, Incident] => [it.message, it.uri, it])
    .reduce(
      (acc, [msg, uri, incident]) => {
        if (!acc[msg]) {
          acc[msg] = [];
        }
        acc[msg].push([uri, incident]);
        return acc;
      },
      {} as { [msg: string]: [string, Incident][] },
    );
