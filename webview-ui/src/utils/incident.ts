import path from "path-browserify";
import { Incident } from "@editor-extensions/shared";

export function getIncidentFile(incident: Incident): string {
  return path.basename(incident.uri.replace(/\\/g, "/"));
}

// The assumption baked into this function is that both incident.uri and workspaceRoot have
// a `file://` prefix. This function simply returns the dirname relative to the workspace root.
export function getIncidentRelativeDir(incident: Incident, workspaceRoot: string): string {
  const normalizedRoot = workspaceRoot.toLocaleLowerCase().replace(/\/$/, "");
  const dir = path.dirname(incident.uri.replace(/\\/g, "/")).toLocaleLowerCase();

  if (normalizedRoot === dir) {
    return "";
  }
  return dir.replace(normalizedRoot + "/", "");
}
