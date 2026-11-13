/**
 * How many analysis locations a single provider is configured with. Each
 * location is a separate analyzer-lsp init-config, and for Java each one
 * resolves its own dependencies, so a monorepo full of projects has to be
 * capped somewhere.
 */
export const MAX_ANALYSIS_LOCATIONS = 10;

const toComparable = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "");

const isSameOrInside = (path: string, maybeParent: string): boolean => {
  const child = toComparable(path);
  const parent = toComparable(maybeParent);
  return child === parent || child.startsWith(`${parent}/`);
};

/**
 * Reduce a set of project directories to the top-most ones, dropping any
 * directory contained in another. A Maven or Gradle project with modules has
 * a build file per module, but the analyzer only needs the directory the
 * build starts from; the nested ones would re-analyze the same sources.
 *
 * Directories listed in `keep` survive even when another directory contains
 * them. A workspace folder the user opened on its own is one: sitting below
 * another project on disk does not make it a module of that project, and
 * dropping it would leave it without its own dependency analysis.
 *
 * Directories are returned in their original form (the analyzer is given
 * these verbatim as locations), shallowest first.
 */
export function topMostDirs(dirs: string[], keep: string[] = []): string[] {
  const kept = new Set(keep.map(toComparable));
  const seen = new Set<string>();
  const unique = dirs.filter((dir) => {
    const key = toComparable(dir);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  const shallowestFirst = unique.sort((a, b) => {
    const [left, right] = [toComparable(a), toComparable(b)];
    return left.split("/").length - right.split("/").length || left.localeCompare(right);
  });

  return shallowestFirst.reduce<string[]>((topMost, dir) => {
    if (kept.has(toComparable(dir)) || !topMost.some((other) => isSameOrInside(dir, other))) {
      topMost.push(dir);
    }
    return topMost;
  }, []);
}
