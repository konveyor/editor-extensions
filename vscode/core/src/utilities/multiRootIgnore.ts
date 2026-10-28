import { relative, sep } from "node:path";
import { Ignore } from "ignore";
import { createIgnoreFromWorkspace, isPathIgnored } from "./ignorePatterns";
import { isOutsideWorkspace } from "./workspaceBoundary";

const _ignoreByRoot = new Map<string, Ignore>();

/**
 * Get the memoized ignore instance for a workspace root, built from that
 * root's own ignore files (.konveyorignore/.gitignore, falling back to the
 * default patterns).
 */
function ignoreForRoot(rootFsPath: string): Ignore {
  let ig = _ignoreByRoot.get(rootFsPath);
  if (!ig) {
    ig = createIgnoreFromWorkspace(rootFsPath).ig;
    _ignoreByRoot.set(rootFsPath, ig);
  }
  return ig;
}

/**
 * Check whether an absolute path should be ignored, judged against the
 * workspace root that contains it. Paths outside the root are ignored.
 */
export function isPathIgnoredInRoot(rootFsPath: string, absoluteFsPath: string): boolean {
  const relPath = relative(rootFsPath, absoluteFsPath);
  if (relPath === "" || isOutsideWorkspace(relPath)) {
    return true;
  }
  // The ignore package matches gitignore-style (posix) paths only.
  const posixRelPath = sep === "/" ? relPath : relPath.split(sep).join("/");
  return isPathIgnored(posixRelPath, ignoreForRoot(rootFsPath));
}

/**
 * Drop the memoized ignore instances so edited ignore files are re-read.
 */
export function resetIgnoreCache(): void {
  _ignoreByRoot.clear();
}
