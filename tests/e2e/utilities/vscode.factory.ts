import { VSCodeWeb } from '../pages/vscode-web.page';
import { VSCodeDesktop } from '../pages/vscode-desktop.page';
import { VSCode } from '../pages/vscode.page';

type RepoInfo = {
  repoUrl: string;
  repoName: string;
  branch?: string;
  language?: string;
};

/**
 * Opens VS Code with the appropriate initialization based on the repo's language.
 * Java repos use full initialization with extension wait, other languages skip Java-specific init.
 */
export async function openForRepo(repoInfo: RepoInfo, prepareOffline = false): Promise<VSCode> {
  const { repoUrl, repoName, branch = 'main', language = 'java' } = repoInfo;
  const needsJavaInit = language === 'java';

  if (needsJavaInit) {
    return init(repoUrl, repoName, branch, prepareOffline);
  } else {
    return open(repoUrl, repoName, branch, false, prepareOffline);
  }
}

/**
 *
 * @param repoUrl
 * @param repoDir
 * @param branch
 * @param waitForInitialization
 * @param prepareOffline if true, extracts LLM cache and sets demoMode/cacheDir before VS Code launches
 */
export async function open(
  repoUrl?: string,
  repoDir?: string,
  branch = 'main',
  waitForInitialization = true,
  prepareOffline = false
) {
  if (process.env.WEB_ENV) {
    return VSCodeWeb.open(repoUrl, repoDir, branch);
  }
  return VSCodeDesktop.open(repoUrl, repoDir, branch, waitForInitialization, prepareOffline);
}

/**
 * @param repoUrl
 * @param repoDir
 * @param branch
 * @param prepareOffline if true, extracts LLM cache and sets demoMode/cacheDir before VS Code launches
 */
export async function init(
  repoUrl?: string,
  repoDir?: string,
  branch?: string,
  prepareOffline = false
): Promise<VSCode> {
  if (process.env.WEB_ENV) {
    return VSCodeWeb.init(repoUrl, repoDir, branch);
  }
  return VSCodeDesktop.init(repoUrl, repoDir, branch, prepareOffline);
}
