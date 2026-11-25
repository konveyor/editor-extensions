import path from "path-browserify";

/**
 * Normalizes a workspace root or file location to a forward-slash path without a
 * trailing slash. Accepts both `file://` URIs and plain file system paths.
 */
export function normalizeWorkspacePath(value: string): string {
  let normalized = (value || "").replace(/\\/g, "/");
  const isUri = normalized.startsWith("file:");
  if (normalized.startsWith("file:///")) {
    normalized = normalized.slice("file://".length);
  } else if (isUri) {
    normalized = normalized.slice("file:".length);
  }
  if (isUri) {
    try {
      normalized = decodeURIComponent(normalized); // "My%20Project" → "My Project"
    } catch {
      // leave a malformed escape as-is
    }
  }
  // "file:///C:/repo" becomes "/C:/repo"; drop the slash so it matches "C:/repo".
  if (/^\/[a-zA-Z]:\//.test(normalized)) {
    normalized = normalized.slice(1);
  }
  return normalized.replace(/\/$/, "");
}

// Windows drive paths are case-insensitive; POSIX paths are compared as-is.
function toComparable(value: string): string {
  return /^[a-zA-Z]:\//.test(value) ? value.toLowerCase() : value;
}

/**
 * Returns `filePath` relative to the workspace folder that contains it. When there is
 * more than one workspace folder, the folder name is prepended, as
 * `vscode.workspace.asRelativePath` does. The longest matching root wins, so nested
 * folders resolve to the innermost one.
 *
 * @returns the display path, or `undefined` if the file is not inside any workspace folder
 */
export function getWorkspaceRelativePath(
  filePath: string,
  workspaceRoots: string[],
): string | undefined {
  const normalizedPath = normalizeWorkspacePath(filePath);
  const comparablePath = toComparable(normalizedPath);
  const roots = workspaceRoots.map(normalizeWorkspacePath).filter(Boolean);

  let match: string | undefined;
  for (const root of roots) {
    if (
      comparablePath.startsWith(toComparable(root) + "/") &&
      (!match || root.length > match.length)
    ) {
      match = root;
    }
  }
  if (!match) {
    return undefined;
  }

  const relativePath = normalizedPath.slice(match.length + 1);
  return roots.length > 1 ? `${path.basename(match)}/${relativePath}` : relativePath;
}
