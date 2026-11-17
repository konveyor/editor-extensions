import { Ignore } from "ignore";
import { Dirent, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { createIgnoreFromWorkspace } from "./ignorePatterns";

/**
 * Safety valve for the directory walk. The walk prunes at every ignored
 * directory, so a normal project visits roughly as many directories as it has
 * source directories. The cap only exists so a pathological tree (or a
 * directory layout we failed to prune) cannot hang analysis startup.
 */
export const DEFAULT_MAX_DIRECTORIES = 50_000;

export interface ResolveExcludedPathsOptions {
  /** Maximum number of directories to read before giving up. */
  maxDirectories?: number;
  /** Called with a human readable message when the walk is truncated or a directory can't be read. */
  onWarning?: (message: string) => void;
}

export interface ResolvedExcludedPaths {
  /** Absolute, directory-marked (trailing separator) paths to hand the analyzer. */
  excludedPaths: string[];
  /** The ignore file the patterns came from, or `null` when defaults were used. */
  ignoreFile: string | null;
  /** True when the walk hit `maxDirectories` and stopped early. */
  truncated: boolean;
}

/**
 * Is a *directory* ignored, in gitignore terms?
 *
 * gitignore matches directories by their trailing-slash form, which is what
 * makes directory-only patterns (`target/`) and the negations that re-include
 * a directory (`!fixtures/keep/`) behave correctly.
 *
 * The `ignore` package resolves each path against its parent directories first
 * and implements gitignore's rule that "it is not possible to re-include a file
 * if a parent directory of that file is excluded". So when this returns true for
 * a directory, every path beneath it is ignored too — which is what makes it
 * safe to emit that directory as a single excluded path and stop descending.
 */
export function isDirectoryIgnored(relativePosixPath: string, ig: Ignore): boolean {
  const normalized = relativePosixPath.startsWith("./")
    ? relativePosixPath.slice(2)
    : relativePosixPath;
  return ig.ignores(normalized.endsWith("/") ? normalized : `${normalized}/`);
}

const toExcludedPath = (root: string, relativePosixPath: string): string =>
  join(root, relativePosixPath) + sep;

/**
 * Resolve a workspace folder's ignore rules into the list of directories the
 * analyzer should skip.
 *
 * Previously this was done by handing the raw ignore patterns to
 * `globby` as search patterns. globby matches them as plain globs, not as
 * gitignore rules, and the two disagree in both directions:
 *
 *  - A negation globby does not understand is dropped, so an explicitly
 *    re-included directory stays on the excluded list and the analyzer skips a
 *    subtree the user asked to keep (a gitignore that ignores `target`
 *    directories at any depth but re-includes the root one with `!/target/`
 *    still gets the root `target` reported as excluded). Over-exclusion
 *    silently loses real incidents.
 *  - Conversely, rooted patterns (`/node_modules`) match nothing as globs, and
 *    bare names (`target`) match only at the root rather than at any depth, so
 *    directories the user ignored were handed to the analyzer anyway.
 *
 * This walks the tree instead and asks the authoritative `ignore` instance
 * about each directory, pruning at the first ignored directory. The resulting
 * list therefore agrees with the ignore rules by construction: no path the
 * ignore rules accept can sit underneath an emitted excluded path.
 *
 * Only directories are returned, each absolute and marked with a trailing
 * separator, matching what the analyzer has always been given.
 *
 * Symbolic links are never followed (they are reported as excluded when they
 * are themselves ignored and resolve to a directory), so a symlink cycle
 * cannot make the walk run away.
 */
export function resolveExcludedPaths(
  root: string,
  options: ResolveExcludedPathsOptions = {},
): ResolvedExcludedPaths {
  const { maxDirectories = DEFAULT_MAX_DIRECTORIES, onWarning } = options;
  const { ig, ignoreFile } = createIgnoreFromWorkspace(root);

  const excludedPaths: string[] = [];
  // Relative, posix-style directories still to be descended into. "" is the root.
  const pending: string[] = [""];
  let directoriesRead = 0;
  let truncated = false;

  while (pending.length > 0) {
    if (directoriesRead >= maxDirectories) {
      truncated = true;
      onWarning?.(
        `Stopped resolving excluded paths after reading ${maxDirectories} directories in ${root}; the excluded path list may be incomplete.`,
      );
      break;
    }

    const relativeDir = pending.pop()!;
    directoriesRead++;

    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, relativeDir), { withFileTypes: true });
    } catch (error) {
      onWarning?.(
        `Could not read directory ${join(root, relativeDir)} while resolving excluded paths: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (isDirectoryIgnored(relativePath, ig)) {
          // Everything below an ignored directory is ignored too, so this single
          // entry covers the whole subtree and there is nothing to descend into.
          excludedPaths.push(toExcludedPath(root, relativePath));
        } else {
          pending.push(relativePath);
        }
        continue;
      }

      if (entry.isSymbolicLink() && isDirectoryIgnored(relativePath, ig)) {
        try {
          if (statSync(join(root, relativePath)).isDirectory()) {
            excludedPaths.push(toExcludedPath(root, relativePath));
          }
        } catch {
          // Broken link, or a link we aren't allowed to resolve: nothing to exclude.
        }
      }
    }
  }

  excludedPaths.sort();
  return { excludedPaths, ignoreFile, truncated };
}
