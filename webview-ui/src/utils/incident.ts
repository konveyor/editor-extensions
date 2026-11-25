import path from "path-browserify";
import { Incident } from "@editor-extensions/shared";
import { getWorkspaceRelativePath } from "./workspacePath";

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

export function getIncidentRelativePath(incident: Incident, workspaceRoot: string): string {
  const normalizedRoot = workspaceRoot.toLocaleLowerCase().replace(/\/$/, "");
  const normalizedIncidentPath = incident.uri.replace(/\\/g, "/").toLocaleLowerCase();

  return normalizedIncidentPath.replace(normalizedRoot, "");
}

/**
 * Returns the path to show for an incident. In a multi-root workspace the path is made
 * relative to the folder that contains the incident and prefixed with that folder's name.
 * With a single folder this is the same as `getIncidentRelativePath`.
 */
export function getIncidentDisplayPath(
  incident: Incident,
  workspaceRoot: string,
  workspaceRoots: string[] = [],
): string {
  if (workspaceRoots.length > 1) {
    const displayPath = getWorkspaceRelativePath(incident.uri, workspaceRoots);
    if (displayPath) {
      return displayPath;
    }
  }
  return getIncidentRelativePath(incident, workspaceRoot);
}
