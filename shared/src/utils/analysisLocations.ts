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
 * Directories are returned in their original form (the analyzer is given
 * these verbatim as locations), shallowest first.
 */
export function topMostDirs(dirs: string[]): string[] {
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
    if (!topMost.some((kept) => isSameOrInside(dir, kept))) {
      topMost.push(dir);
    }
    return topMost;
  }, []);
}
