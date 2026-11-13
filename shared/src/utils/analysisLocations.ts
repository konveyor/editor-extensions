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

const shallowestFirst = (dirs: string[]): string[] =>
  [...dirs].sort((a, b) => {
    const [left, right] = [toComparable(a), toComparable(b)];
    return left.split("/").length - right.split("/").length || left.localeCompare(right);
  });

const withoutDuplicates = (dirs: string[]): string[] => {
  const seen = new Set<string>();
  return dirs.filter((dir) => {
    const key = toComparable(dir);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
  return shallowestFirst(withoutDuplicates(dirs)).reduce<string[]>((topMost, dir) => {
    if (!topMost.some((kept) => isSameOrInside(dir, kept))) {
      topMost.push(dir);
    }
    return topMost;
  }, []);
}

/**
 * Resolve the analysis locations for a workspace, given the project
 * directories found in each of its folders.
 *
 * Directories are reduced to the top-most ones within a folder only. Across
 * folders, one project sitting below another on disk says nothing about the
 * build: a folder opened on its own, or a project found under one, need not
 * be a module of a project in a folder that happens to contain it, and
 * dropping it would leave it without its own dependency analysis. The same
 * directory found from two folders is still one location.
 */
export function analysisLocations(projectDirsByFolder: string[][]): string[] {
  return shallowestFirst(withoutDuplicates(projectDirsByFolder.flatMap(topMostDirs)));
}
