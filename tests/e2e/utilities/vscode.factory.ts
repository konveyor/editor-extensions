import { VSCodeWeb } from '../pages/vscode-web.page';
import { VSCodeDesktop } from '../pages/vscode-desktop.page';
import { VSCode } from '../pages/vscode.page';

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
