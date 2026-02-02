import { generateRandomString, getOSInfo } from './e2e/utilities/utils';
import { KAIViews } from './e2e/enums/views.enum';
import * as VSCodeFactory from './e2e/utilities/vscode.factory';
import { VSCodeDesktop } from './e2e/pages/vscode-desktop.page';
import { existsSync } from 'node:fs';
import fs from 'fs';
import testReposData from './e2e/fixtures/test-repos.json';
import { installExtension } from './e2e/utilities/vscode-commands.utils';
import { verifyCSharpTools } from './e2e/utilities/csharp.utils';

type RepoData = {
  repoUrl?: string;
  language?: string;
};

function getRepoData(repoName: string): RepoData {
  return (testReposData as Record<string, RepoData>)[repoName] ?? {};
}

function getRepoUrl(repoName: string): string {
  const repoData = getRepoData(repoName);
  return repoData.repoUrl ?? process.env.TEST_REPO_URL ?? 'https://github.com/konveyor-ecosystem/coolstore';
}

function getRepoLanguage(repoName: string): string {
  const repoData = getRepoData(repoName);
  // Default to 'java' for backwards compatibility
  return repoData.language ?? 'java';
}

function needsJavaInitialization(language: string): boolean {
  return language === 'java';
}

async function globalSetup() {
  // Removes the browser's context if the test are running in VSCode Web
  if (process.env.WEB && existsSync('./web-state.json')) {
    fs.rmSync('./web-state.json');
  }
  const repoName = process.env.TEST_REPO_NAME ?? 'coolstore';
  const repoUrl = process.env.TEST_REPO_URL ?? getRepoUrl(repoName);
  const language = getRepoLanguage(repoName);
  const isJava = needsJavaInitialization(language);
  console.log(`Running global setup... (language: ${language}, Java init: ${isJava})`);

  // Install extensions from VSIX if provided (VSCode Desktop only, not on devspaces)
  if ((process.env.CORE_VSIX_FILE_PATH || process.env.CORE_VSIX_DOWNLOAD_URL) && !process.env.WEB) {
    await installExtension();
  }

  // Verify C# tools if running C# tests
  // Check both language and CSHARP_VSIX_FILE_PATH to catch C# tests
  const isCSharpTest = language === 'csharp' || !!process.env.CSHARP_VSIX_FILE_PATH;
  if (isCSharpTest && !process.env.WEB) {
    await verifyCSharpTools();
  }

  // For Java repos, use init() which installs extensions and waits for Java initialization
  // For other languages, use open() which skips Java-specific initialization
  const vscodeApp = isJava
    ? await VSCodeFactory.init(repoUrl, repoName)
    : await VSCodeFactory.open(repoUrl, repoName, 'main', false);

  if (getOSInfo() === 'windows' && process.env.CI) {
    await vscodeApp.getWindow().waitForTimeout(60000);
  }

  // Wait for extension initialization (Java only)
  // Both redhat.java and konveyor-java extensions will activate automatically
  // via workspaceContains activation events (pom.xml, build.gradle, etc.)
  if (isJava && vscodeApp instanceof VSCodeDesktop) {
    await vscodeApp.waitForExtensionInitialization();
  }

  // For non-Java languages, just wait a bit for extensions to load
  if (!isJava) {
    console.log(`${language} mode: waiting for extensions to load...`);
    await vscodeApp.getWindow().waitForTimeout(10000);
  }

  await vscodeApp.openAnalysisView();
  await vscodeApp.closeVSCode();
  console.log('Completed global setup.');

  if (getOSInfo() === 'windows' && process.env.CI) {
    const vscodeApp = await VSCodeFactory.open(repoUrl, repoName, 'main', true);
    await vscodeApp.createProfile([], ['openjdk17'], generateRandomString());
    await vscodeApp.configureGenerativeAI();
    await vscodeApp.openAnalysisView();
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    console.log('Starting server...');
    const startButton = analysisView.getByRole('button', { name: 'Start' });
    await startButton.waitFor({ state: 'visible', timeout: 10000 });
    await startButton.click({ delay: 500 });
    await vscodeApp.getWindow().waitForTimeout(60000);
    await vscodeApp.closeVSCode();
  }
}

export default globalSetup;
