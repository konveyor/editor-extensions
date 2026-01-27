import { VSCodeWeb } from '../pages/vscode-web.page';
import { VSCodeDesktop } from '../pages/vscode-desktop.page';
import { VSCode } from '../pages/vscode.page';

type RepoInfo = {
  repoUrl: string;
  repoName: string;
  branch?: string;
  language?: string;
  workspacePath?: string;
};

/**
 * Opens VS Code with the appropriate initialization based on the repo's language.
 * Java repos use full initialization with extension wait, other languages skip Java-specific init.
 * If workspacePath is provided, it will be used as the workspace directory (relative to repoName).
 * For C# and other non-Java languages, extensions are installed if VSIX paths are provided.
 */
export async function openForRepo(repoInfo: RepoInfo, prepareOffline = false): Promise<VSCode> {
  const { repoUrl, repoName, branch = 'main', language = 'java', workspacePath } = repoInfo;
  const needsJavaInit = language === 'java';

  // If workspacePath is provided, construct the full path relative to repoName
  const repoDir = workspacePath ? `${repoName}/${workspacePath}` : repoName;

  if (needsJavaInit) {
    return init(repoUrl, repoDir, branch, prepareOffline);
  } else {
    // For non-Java languages, install extensions if VSIX paths are provided
    // This ensures C#, JavaScript, Go extensions are installed when needed
    return open(repoUrl, repoDir, branch, false, prepareOffline);
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
