import { isAbsolute, sep } from "node:path";

/**
 * True for a `path.relative(workspaceRoot, p)` result that points outside the
 * workspace: "..", "../…", or an absolute path (Windows cross-drive).
 */
export function isOutsideWorkspace(relativePath: string, separator: string = sep): boolean {
  return (
    relativePath === ".." || relativePath.startsWith(".." + separator) || isAbsolute(relativePath)
  );
}
