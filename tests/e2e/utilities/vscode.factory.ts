import { VSCodeWeb } from '../pages/vscode-web.page';
import { VSCodeDesktop } from '../pages/vscode-desktop.page';
import { VSCode } from '../pages/vscode.page';

/**
 *
 * @param repoUrl
 * @param repoDir
 * @param branch
 * @param waitForInitialization
 */
export async function open(
  repoUrl?: string,
  repoDir?: string,
  branch = 'main',
  waitForInitialization = true
) {
  if (process.env.WEB_ENV) {
    return VSCodeWeb.open(repoUrl, repoDir, branch);
  }
  return VSCodeDesktop.open(repoUrl, repoDir, branch, waitForInitialization);
}

/**
 * @param repoUrl
 * @param repoDir
 * @param branch
 */
export async function init(repoUrl?: string, repoDir?: string, branch?: string): Promise<VSCode> {
  if (process.env.WEB_ENV) {
    return VSCodeWeb.init(repoUrl, repoDir, branch);
  }
  return VSCodeDesktop.init(repoUrl, repoDir, branch);
}
