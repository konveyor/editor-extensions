import { VSCodeWeb } from '../pages/vscode-web.page';
import { VSCodeDesktop } from '../pages/vscode-desktop.page';
import { VSCode } from '../pages/vscode.page';
import { RepoInfo } from '../types/repo-info';

export { RepoInfo };

/**
 * Opens VS Code with the appropriate initialization based on the repo's language.
 * Java repos use full initialization with extension wait, other languages skip Java-specific init.
 * If workspacePath is provided, it will be used as the workspace directory (relative to repoName).
 * For C# and other non-Java languages, extensions are installed if VSIX paths are provided.
 */
export async function openForRepo(repoInfo: RepoInfo, prepareOffline = false): Promise<VSCode> {
  const needsJavaInit = (repoInfo.language ?? 'java') === 'java';

  if (needsJavaInit) {
    return init(repoInfo, prepareOffline);
  } else {
    return open(repoInfo, false, prepareOffline);
  }
}

/**
 * @param repoInfo
 * @param waitForInitialization
 * @param prepareOffline if true, extracts LLM cache and sets demoMode/cacheDir before VS Code launches
 */
export async function open(
  repoInfo?: RepoInfo,
  waitForInitialization = true,
  prepareOffline = false
) {
  if (process.env.WEB_ENV) {
    return VSCodeWeb.open(repoInfo);
  }
  return VSCodeDesktop.open(repoInfo, waitForInitialization, prepareOffline);
}

/**
 * @param repoInfo
 * @param prepareOffline if true, extracts LLM cache and sets demoMode/cacheDir before VS Code launches
 */
export async function init(repoInfo?: RepoInfo, prepareOffline = false): Promise<VSCode> {
  if (process.env.WEB_ENV) {
    return VSCodeWeb.init(repoInfo);
  }
  return VSCodeDesktop.init(repoInfo, prepareOffline);
}
