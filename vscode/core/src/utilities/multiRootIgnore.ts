import { readdirSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";
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

const withoutTrailingSep = (path: string): string => {
  const normalized = normalize(path);
  return normalized.length > 1 && normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized;
};

const isInside = (parent: string, child: string): boolean => {
  const rel = relative(parent, child);
  return rel !== "" && !isOutsideWorkspace(rel);
};

/**
 * Keep one workspace root's excluded paths from reaching into another root.
 *
 * Excluded paths are sent to the analyzer as a single global list, and
 * analyzer-lsp matches each one as an unanchored regex against file paths. So
 * a root whose ignore files exclude a directory that holds — or merely shares
 * a name prefix with — another workspace root would silently exclude that
 * root's sources, even though the nested root's own ignore rules allow them.
 *
 * Such an exclusion is narrowed to the siblings that don't reach the other
 * root, and exclusions landing inside another root are dropped so that root's
 * own rules decide.
 */
export function scopeExcludedPathsToRoot(
  rootFsPath: string,
  excludedPaths: string[],
  allRootFsPaths: string[],
): string[] {
  const root = withoutTrailingSep(rootFsPath);
  const nestedRoots = allRootFsPaths
    .map(withoutTrailingSep)
    .filter((other) => isInside(root, other));
  if (nestedRoots.length === 0) {
    return excludedPaths;
  }
  return excludedPaths.flatMap((excluded) => scopeExcludedPath(excluded, nestedRoots));
}

function scopeExcludedPath(excludedPath: string, nestedRoots: string[]): string[] {
  const path = withoutTrailingSep(excludedPath);

  if (nestedRoots.some((root) => root === path || isInside(root, path))) {
    return [];
  }
  if (!nestedRoots.some((root) => root.startsWith(path))) {
    return [excludedPath];
  }

  let children: string[];
  try {
    children = readdirSync(path);
  } catch {
    // Unreadable, so it can't be narrowed. Dropping it only costs analysis
    // time; keeping it would drop another root's incidents.
    return [];
  }
  return children.flatMap((child) => scopeExcludedPath(join(path, child), nestedRoots));
}
