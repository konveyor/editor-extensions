import { fileURLToPath } from "url";

export function fileUriToPath(path: string): string {
  const cleanPath = path.startsWith("file://") ? fileURLToPath(path) : path;
  return process.platform === "win32" && cleanPath.match(/^\/[A-Za-z]:\//)
    ? cleanPath.substring(1)
    : cleanPath;
}
