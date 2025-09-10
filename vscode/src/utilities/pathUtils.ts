import * as path from "path";
import { fileURLToPath } from "url";

export function fileUriToPath(path: string): string {
  const cleanPath = path.startsWith("file://") ? fileURLToPath(path) : path;
  return process.platform === "win32" && cleanPath.match(/^\/[A-Za-z]:\//)
    ? cleanPath.substring(1)
    : cleanPath;
}

/**
 * Normalize a filesystem path by removing redundant . and \ chars. Capitalizes Windows drive letters.
 */
export function normalizeFilePath(inputPath: string): string {
  if (!inputPath) {
    return inputPath;
  }
  const fsPath = fileUriToPath(inputPath);
  let normalized = path.normalize(fsPath);
  if (process.platform === "win32") {
    normalized = normalized.replace(/^([a-z]):/, (m, p1) => `${p1.toUpperCase()}:`);
  }
  return normalized;
}
