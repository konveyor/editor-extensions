import { readdirSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
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

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The regex analyzer-lsp makes of an excluded path. Off Windows it compiles
 * the path as it stands, so a `.` in a directory name is a wildcard; on
 * Windows it quotes the path first and accepts either separator. A path that
 * does not compile is skipped by the analyzer's regex scope and only matched
 * as a literal directory.
 */
const analyzerPattern = (path: string): string => {
  if (sep === "\\") {
    return escapeRegExp(path).replace(/\\\\/g, "[\\\\/]");
  }
  try {
    new RegExp(path);
    return path;
  } catch {
    return escapeRegExp(path);
  }
};

const selfAndAncestors = (path: string): string[] => {
  const parent = dirname(path);
  return parent === path ? [path] : [path, ...selfAndAncestors(parent)];
};

/**
 * Whether the exclusion, read the way the analyzer reads it, is the other root
 * or a path below it: some leading directory of the exclusion matches the
 * root's path through to its end.
 */
const landsInRoot = (path: string, otherRoot: string): boolean =>
  selfAndAncestors(path).some((dir) => new RegExp(`(?:${analyzerPattern(dir)})$`).test(otherRoot));

/**
 * Whether the exclusion matches somewhere along the other root's own path, so
 * that it would exclude everything in that root: by containing it, by sharing
 * a name prefix with it, or by a regex wildcard standing in for a character.
 */
const reachesRoot = (path: string, otherRoot: string): boolean =>
  new RegExp(analyzerPattern(path)).test(otherRoot);

/**
 * Keep one workspace root's excluded paths from reaching into another root.
 *
 * Excluded paths are sent to the analyzer as a single global list, and
 * analyzer-lsp matches each one as an unanchored regex against file paths. So
 * a root whose ignore files exclude a directory that holds another workspace
 * root — or shares a name prefix with one, or differs from one only where the
 * regex has a wildcard (`service.v1` matches `service-v1`) — would silently
 * exclude that root's sources, even though that root's own ignore rules allow
 * them.
 *
 * Such an exclusion is narrowed to the children that don't reach the other
 * root, and exclusions that land inside another root are dropped so that
 * root's own rules decide. An exclusion that cannot be told apart from another
 * root by the analyzer is dropped too: analyzing an ignored directory costs
 * time, excluding a workspace root loses its incidents.
 *
 * Roots that contain this one are not considered: everything this root
 * excludes is inside them by definition.
 */
export function scopeExcludedPathsToRoot(
  rootFsPath: string,
  excludedPaths: string[],
  allRootFsPaths: string[],
): string[] {
  const root = withoutTrailingSep(rootFsPath);
  const otherRoots = [...new Set(allRootFsPaths.map(withoutTrailingSep))].filter(
    (other) => other !== root && !isInside(other, root),
  );
  if (otherRoots.length === 0) {
    return excludedPaths;
  }
  return excludedPaths.flatMap((excluded) => scopeExcludedPath(excluded, otherRoots));
}

function scopeExcludedPath(excludedPath: string, otherRoots: string[]): string[] {
  const path = withoutTrailingSep(excludedPath);

  if (otherRoots.some((root) => landsInRoot(path, root))) {
    return [];
  }
  if (!otherRoots.some((root) => reachesRoot(path, root))) {
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
  return children.flatMap((child) => scopeExcludedPath(join(path, child), otherRoots));
}
