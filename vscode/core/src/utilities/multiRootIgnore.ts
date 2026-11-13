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

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/;

/**
 * Whether analyzer-lsp reads this excluded path as a regex with something
 * other than literal characters in it. Off Windows it compiles the path as it
 * stands, so a `.` in a directory name stands for any character — a path
 * separator included. On Windows it quotes the path first, and a path that
 * does not compile is skipped by its regex scope; both are matched literally.
 */
const isReadAsRegex = (path: string): boolean => {
  if (sep === "\\" || !REGEX_SPECIAL.test(path)) {
    return false;
  }
  try {
    new RegExp(path);
    return true;
  } catch {
    return false;
  }
};

const matchesWhole = (pattern: string, text: string): boolean => {
  try {
    return new RegExp(`^(?:${pattern})$`).test(text);
  } catch {
    // Not a pattern on its own, e.g. cut in the middle of a group.
    return false;
  }
};

/**
 * Whether the exclusion could match a path in the other root's tree: the root
 * itself, or anything below it, whether or not it exists yet.
 *
 * Read literally that is plain containment. Read as a regex, it is so when
 * some leading part of the pattern matches the root's path through to the
 * separator that follows it — `/repo/app.v1/generated` lands in `/repo/app`,
 * because `/repo/app.` matches `/repo/app/` and the rest can match below it.
 */
const landsInRoot = (path: string, otherRoot: string): boolean => {
  if (path === otherRoot || isInside(otherRoot, path)) {
    return true;
  }
  if (!isReadAsRegex(path)) {
    return false;
  }
  if (matchesWhole(path, otherRoot)) {
    return true;
  }
  const rootDir = otherRoot + sep;
  const literalLength = path.search(REGEX_SPECIAL);
  if (!rootDir.startsWith(path.slice(0, literalLength))) {
    return false;
  }
  for (let end = literalLength + 1; end <= path.length; end++) {
    if (matchesWhole(path.slice(0, end), rootDir)) {
      return true;
    }
  }
  return false;
};

/**
 * Whether the exclusion matches somewhere along the other root's own path, so
 * that it would exclude everything in that root: by containing it, by sharing
 * a name prefix with it, or by a regex wildcard standing in for a character.
 */
const reachesRoot = (path: string, otherRoot: string): boolean =>
  isReadAsRegex(path) ? new RegExp(path).test(otherRoot) : otherRoot.startsWith(path);

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
 * root. One that could match a path anywhere in another root's tree is
 * dropped, so that root's own rules decide: analyzing an ignored directory
 * costs time, excluding another root's sources loses its incidents.
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
