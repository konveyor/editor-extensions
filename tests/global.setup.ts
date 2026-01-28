import { generateRandomString, getOSInfo } from './e2e/utilities/utils';
import { KAIViews } from './e2e/enums/views.enum';
import * as VSCodeFactory from './e2e/utilities/vscode.factory';
import { VSCodeDesktop } from './e2e/pages/vscode-desktop.page';
import { existsSync } from 'node:fs';
import fs from 'fs';
import { execSync } from 'child_process';
import path from 'node:path';
import testReposData from './e2e/fixtures/test-repos.json';
import { installExtension } from './e2e/utilities/vscode-commands.utils';

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

/**
 * Verifies that required C# tools are installed and accessible.
 * Checks for .NET SDK, ilspycmd, and paket.
 */
async function verifyCSharpTools(): Promise<void> {
  const checks: Array<{ name: string; command: string; check: () => boolean }> = [
    {
      name: '.NET SDK',
      command: 'dotnet --version',
      check: () => {
        try {
          execSync('dotnet --version', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
    },
    {
      name: 'ilspycmd',
      command: 'ilspycmd --version',
      check: () => {
        try {
          execSync('ilspycmd --version', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
    },
    {
      name: 'paket',
      command: 'paket --version',
      check: () => {
        try {
          execSync('paket --version', { stdio: 'pipe' });
          return true;
        } catch {
          return false;
        }
      },
    },
  ];

  const results: string[] = [];
  let allPassed = true;

  for (const check of checks) {
    const passed = check.check();
    results.push(`${passed ? '✔' : '✖'} ${check.name} ${passed ? 'installed' : 'NOT found'}`);
    if (!passed) {
      allPassed = false;
    }
  }

  // Check if $HOME/.dotnet/tools is in PATH
  const dotnetToolsPath = process.env.HOME
    ? path.join(process.env.HOME, '.dotnet', 'tools')
    : path.join(process.env.USERPROFILE || '', '.dotnet', 'tools');
  const pathEnv = process.env.PATH || '';
  const pathEntries = pathEnv.split(path.delimiter).map((p) => path.normalize(p));
  const toolsInPath = pathEntries.includes(path.normalize(dotnetToolsPath));
  
  results.push(
    `${toolsInPath ? '✔' : '✖'} $HOME/.dotnet/tools ${toolsInPath ? 'in PATH' : 'NOT in PATH'}`
  );
  if (!toolsInPath) {
    allPassed = false;
  }

  console.log('C# Tools Verification:');
  results.forEach((result) => console.log(`  ${result}`));

  if (!allPassed) {
    console.warn('\n⚠️  Warning: Some C# tools are missing. C# tests may fail.');
    console.warn('Please install missing tools:');
    console.warn('  - .NET SDK 8.0.x: https://dotnet.microsoft.com/download/dotnet/8.0');
    console.warn('  - ilspycmd: dotnet tool install --global ilspycmd');
    console.warn('  - paket: dotnet tool install --global paket');
    console.warn('  - Add to PATH: export PATH="$HOME/.dotnet/tools:$PATH"\n');
  } else {
    console.log('✅ All C# tools verified successfully.\n');
  }
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

  // Verify C# tools if running C# tests
  // Check both language and CSHARP_VSIX_FILE_PATH to catch C# tests
  const isCSharpTest = language === 'csharp' || !!process.env.CSHARP_VSIX_FILE_PATH;
  if (isCSharpTest) {
    await verifyCSharpTools();
  }
  
  // Install extensions from VSIX if provided (VSCode Desktop only, not on devspaces)
  if ((process.env.CORE_VSIX_FILE_PATH || process.env.CORE_VSIX_DOWNLOAD_URL) && !process.env.WEB) {
    await installExtension();
  }
  
  // For Java repos, use init() which waits for Java initialization
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
