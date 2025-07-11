import { fileURLToPath } from "url";

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
