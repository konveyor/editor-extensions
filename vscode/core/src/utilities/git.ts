import * as vscode from "vscode";
import * as path from "path";
import winston from "winston";

/**
 * VS Code Git API types
 */
interface GitExtension {
  getAPI(version: number): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
  getRepository(uri: vscode.Uri): Repository | null;
}

interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
  // Subset of the vscode.git API (extensions/git/src/api/git.d.ts).
  checkout(treeish: string): Promise<void>;
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  getBranch(name: string): Promise<Branch>;
  setBranchUpstream(name: string, upstream: string): Promise<void>;
  pull(unshallow?: boolean): Promise<void>;
  fetch(remote?: string, ref?: string, depth?: number): Promise<void>;
  getMergeBase(ref1: string, ref2: string): Promise<string | undefined>;
  diffBetween(ref1: string, ref2: string): Promise<Change[]>;
  show(ref: string, path: string): Promise<string>;
}

/** A changed file between two refs; `uri` is the file's path in the working tree. */
export interface Change {
  readonly uri: vscode.Uri;
  readonly originalUri: vscode.Uri;
  readonly renameUri: vscode.Uri | undefined;
}

export type GitRepository = Repository;

/** The remote to fetch run branches from: `origin`, else the first one. */
export function preferredRemote(repo: GitRepository): string | undefined {
  return repo.state.remotes.find((r) => r.name === "origin")?.name ?? repo.state.remotes[0]?.name;
}

/** Tracked files with uncommitted changes (untracked files do not block a checkout). */
export function uncommittedChangeCount(repo: GitRepository): number {
  const { mergeChanges, indexChanges, workingTreeChanges } = repo.state;
  return (
    (mergeChanges?.length ?? 0) + (indexChanges?.length ?? 0) + (workingTreeChanges?.length ?? 0)
  );
}

/** The vscode.git repository that contains `workspaceRoot`, if any. */
export function getGitRepository(workspaceRoot: string): GitRepository | null {
  const api = getGitAPI();
  if (!api) {
    return null;
  }
  const uri = workspaceRoot.startsWith("file:")
    ? vscode.Uri.parse(workspaceRoot)
    : vscode.Uri.file(workspaceRoot);
  return api.getRepository(uri);
}

interface RepositoryState {
  remotes: Remote[];
  HEAD?: Branch;
  readonly mergeChanges: Change[];
  readonly indexChanges: Change[];
  readonly workingTreeChanges: Change[];
}

interface Branch {
  name?: string;
}

interface Remote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

/**
 * Normalize a git remote URL by removing the scheme and .git suffix
 * Examples:
 *   https://github.com/org/repo.git -> github.com/org/repo
 *   git@github.com:org/repo.git -> github.com/org/repo
 *   ssh://git@gitlab.com/org/repo.git -> gitlab.com/org/repo
 */
function normalizeGitUrl(url: string): string {
  let normalized = url.trim();

  // Remove common git protocols
  // Handle ssh://git@host/path format first (before removing ssh://)
  normalized = normalized.replace(/^ssh:\/\/git@([^/]+)\//, "$1/"); // Convert ssh://git@host/path to host/path
  normalized = normalized
    .replace(/^https?:\/\//, "") // Remove https:// or http://
    .replace(/^ssh:\/\//, "") // Remove ssh:// (for any remaining ssh:// URLs)
    .replace(/^git@([^:]+):/, "$1/") // Convert git@host:path to host/path
    .replace(/\.git$/, ""); // Remove .git suffix

  return normalized;
}

/**
 * Get the VS Code Git extension API
 */
function getGitAPI(): GitAPI | null {
  try {
    const gitExtension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!gitExtension) {
      return null;
    }

    if (!gitExtension.isActive) {
      return null;
    }

    return gitExtension.exports.getAPI(1);
  } catch {
    return null;
  }
}

/**
 * Information about a git repository and workspace location
 */
export interface RepositoryInfo {
  /** Absolute path to git repository root */
  repositoryRoot: string;
  /** Current branch name */
  currentBranch: string;
  /** Normalized remote URL (no scheme, no .git suffix) */
  remoteUrl: string;
  /** Path relative to repository root ("" if workspace is at root) */
  workspaceRelativePath: string;
}

/**
 * Get comprehensive repository information for the workspace.
 * Returns null if not a git repository or if no remote is configured.
 *
 * Uses VS Code's built-in Git extension API instead of shell commands.
 */
export async function getRepositoryInfo(
  workspaceRoot: string,
  logger?: winston.Logger,
): Promise<RepositoryInfo | null> {
  try {
    // Get VS Code's Git API
    const gitAPI = getGitAPI();

    if (!gitAPI) {
      if (logger) {
        logger.debug("VS Code Git extension not available", { workspaceRoot });
      }
      return null;
    }

    // Convert workspace root to URI
    // Handle both file:// URIs and file paths
    let workspaceUri: vscode.Uri;
    if (workspaceRoot.startsWith("file://")) {
      workspaceUri = vscode.Uri.parse(workspaceRoot);
    } else {
      workspaceUri = vscode.Uri.file(workspaceRoot);
    }

    // Find the repository for this workspace
    const repository = gitAPI.getRepository(workspaceUri);

    if (!repository) {
      if (logger) {
        logger.debug("No git repository found for workspace", { workspaceRoot });
      }
      return null;
    }

    // Get repository root path
    const repositoryRoot = repository.rootUri.fsPath;

    // Get workspace path as a file system path (not URI)
    const workspaceFsPath = workspaceUri.fsPath;

    // Calculate workspace path relative to repository root using Node.js path module
    const workspaceRelativePath =
      path.relative(repositoryRoot, workspaceFsPath).replace(/\\/g, "/") || "";

    // Get current branch
    const head = repository.state.HEAD;
    const currentBranch = head?.name || "";

    // Get remotes from the repository
    const remotes = repository.state.remotes;

    if (!remotes || remotes.length === 0) {
      if (logger) {
        logger.warn("No git remotes found for workspace", { workspaceRoot });
      }
      return null;
    }

    if (logger) {
      const remoteInfo = remotes.map((r) => ({
        name: r.name,
        fetchUrl: r.fetchUrl,
        pushUrl: r.pushUrl,
      }));
      logger.debug("Git remotes detected", { remotes: remoteInfo });
    }

    // Prefer origin, otherwise use first remote
    const selectedRemote = remotes.find((r) => r.name === "origin") || remotes[0];

    // Use fetchUrl if available, otherwise pushUrl
    const remoteUrl = selectedRemote.fetchUrl || selectedRemote.pushUrl;

    if (!remoteUrl) {
      if (logger) {
        logger.warn("Selected remote has no URL", {
          remoteName: selectedRemote.name,
        });
      }
      return null;
    }

    const normalized = normalizeGitUrl(remoteUrl);

    if (logger) {
      logger.info("Detected repository information", {
        repositoryRoot,
        workspaceRoot,
        workspaceRelativePath,
        currentBranch,
        remoteUrl: normalized,
        remoteName: selectedRemote.name,
      });
    }

    return {
      repositoryRoot,
      currentBranch,
      remoteUrl: normalized,
      workspaceRelativePath,
    };
  } catch (error) {
    // Not a git repository or git API failed
    if (logger) {
      logger.debug("Failed to detect git repository", { workspaceRoot, error });
    }
    return null;
  }
}
