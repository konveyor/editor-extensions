import * as pathlib from "path";
import { fileURLToPath } from "url";

import { BaseInputMetaState } from "./schemas/base";

/**
 * Removes file:// prefix in URLs passed by vscode extension
 * @param path input path to clean
 */
export function fileUriToPath(path: string): string {
  const cleanPath = path.startsWith("file://") ? fileURLToPath(path) : path;
  return process.platform === "win32" && cleanPath.startsWith("/")
    ? cleanPath.replace("/", "")
    : cleanPath;
}

// used as a name for the subdirectory in the cache to store the results of current run
export function getCacheKey(state: typeof BaseInputMetaState.State, suffix: string = ""): string {
  return pathlib.join(state.cacheSubDir, state.iterationCount.toString(), suffix);
}
