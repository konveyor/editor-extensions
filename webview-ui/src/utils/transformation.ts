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
