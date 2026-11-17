import { relative, sep } from "node:path";

/**
 * Directory names a glob cannot name literally. A directory called `app{1}`
 * would turn a brace list into a different pattern, so such a directory is
 * left out of the exclude rather than guessed at — the search then walks it,
 * and the ignore check drops whatever it finds there.
 */
const GLOB_UNSAFE = /[*?[\]{}!(),]/;

/**
 * Whether a folder's ignore patterns re-include anything they ignore.
 *
 * It matters because a resolved list of ignored directories names the
 * directory and not the exception inside it: with `fixtures/` and
 * `!fixtures/keep/`, the list holds `fixtures` alone, so excluding it from a
 * search would hide `fixtures/keep` — a project the user does want. Callers
 * give up the optimization rather than risk that.
 */
export function reIncludesSomething(patterns: string[]): boolean {
  return patterns.some((pattern) => pattern.startsWith("!"));
}

/**
 * Assemble the exclude glob for a workspace folder's project search from the
 * directory names to skip at any depth and the absolute directories the
 * folder's ignore rules exclude.
 *
 * The ignored directories are anchored to the folder, since they are places
 * rather than names, and are dropped when they fall outside it or cannot be
 * written literally in a glob.
 */
export function buildProjectSearchExclude(
  folderFsPath: string,
  alwaysSkipDirs: string[],
  ignoredDirs: string[],
): string {
  const anchored = ignoredDirs
    .map((dir) => relative(folderFsPath, dir).split(sep).join("/").replace(/\/+$/, ""))
    .filter((dir) => dir !== "" && !dir.startsWith("..") && !GLOB_UNSAFE.test(dir))
    .map((dir) => `${dir}/**`);

  const patterns = [...new Set([...alwaysSkipDirs.map((dir) => `**/${dir}/**`), ...anchored])];
  return patterns.length === 1 ? patterns[0] : `{${patterns.join(",")}}`;
}
