import path from "path-browserify";
import { Incident } from "@editor-extensions/shared";

// The assumption baked into this function is that both incident.uri and workspaceRoot have
// a `file://` prefix. This function simply returns the dirname relative tot he workspace root.
export function getIncidentRelativeDir(incident: Incident, workspaceRoot: string): string {
  const dir = path.dirname(incident.uri.replace(/\\/g, "/"));
  return dir.toLocaleLowerCase().replace(workspaceRoot.toLocaleLowerCase() + "/", "");
}
