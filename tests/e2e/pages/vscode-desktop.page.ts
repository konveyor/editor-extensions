import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { _electron as electron } from 'playwright';
import { ElectronApplication, expect, Page } from '@playwright/test';
import { createZip, extractZip } from '../utilities/archive';
import { cleanupRepo, getOSInfo, writeOrUpdateSettingsJson } from '../utilities/utils';
import { KAIViews } from '../enums/views.enum';
import { TEST_DATA_DIR } from '../utilities/consts';
import { installExtension, isExtensionInstalled } from '../utilities/vscode-commands.utils';
import { stubDialog } from 'electron-playwright-helpers';
import { extensionId, redhatJavaExtensionId } from '../utilities/utils';
import { VSCode } from './vscode.page';

/**
 * Prepare workspace for offline/cached mode BEFORE VS Code launches.
 * This extracts the LLM cache and sets up demoMode settings so the extension
 * can use cached healthcheck data during activation.
 * @param repoDir The workspace directory to prepare
 */
export function prepareOfflineWorkspace(repoDir: string): void {
  const storedPath = path.join(__dirname, '..', '..', 'data', 'llm_cache.zip');
  const cachePath = path.join(repoDir, '.vscode', 'cache');

  // Extract cache if zip exists
  if (fs.existsSync(storedPath)) {
    if (fs.existsSync(cachePath)) {
      fs.rmSync(cachePath, { recursive: true, force: true });
    }
    fs.mkdirSync(cachePath, { recursive: true });
    extractZip(storedPath, cachePath);
    console.log(`Extracted LLM cache to ${cachePath}`);
  } else {
    console.warn(`LLM cache zip not found at ${storedPath}`);
  }

  // Set demoMode and cacheDir in settings BEFORE VS Code launches
  writeOrUpdateSettingsJson(path.join(repoDir, '.vscode', 'settings.json'), {
    'konveyor-core.genai.demoMode': true,
    'konveyor-core.genai.cacheDir': '.vscode/cache',
  });
  console.log('Set demoMode and cacheDir in workspace settings');
}

export class VSCodeDesktop extends VSCode {
  protected readonly app: ElectronApplication;
  protected window: Page;

  constructor(app: ElectronApplication, window: Page, repoDir?: string, branch?: string) {
    super();
    this.app = app;
    this.window = window;
    this.repoDir = repoDir;
    this.branch = branch;
  }

  public static async open(
    repoUrl?: string,
    repoDir?: string,
    branch = 'main',
    waitForInitialization = true,
    prepareOffline = false
  ) {
    /**
     * user-data-dir is passed to force opening a new instance avoiding the process to couple with an existing vscode instance
     * so Playwright doesn't detect that the process has finished
     */
    const args = [
      '--disable-workspace-trust',
      '--skip-welcome',
      `--user-data-dir=${TEST_DATA_DIR}`,
    ];

    try {
      if (repoUrl) {
        // Extract the top-level repo name from repoDir for cleanup
        // repoDir might be "repoName" or "repoName/workspacePath" or "repoName\\workspacePath" (Windows)
        const topLevelRepoName = repoDir ? repoDir.split(/[\\/]/)[0] : undefined;
        if (topLevelRepoName) {
          await cleanupRepo(topLevelRepoName);
        }
        console.log(`Cloning repository from ${repoUrl} -b ${branch}`);
        execSync(`git clone ${repoUrl} -b ${branch}`, { stdio: 'pipe' });
      }
    } catch (error: any) {
      console.error(error);
      throw new Error('Failed to clone the repository');
    }

    if (repoDir) {
      args.push(path.resolve(repoDir));
    }

    // Prepare offline workspace if requested - must happen AFTER repo is cloned
    // but BEFORE VS Code launches, so demoMode/cacheDir are available at activation
    if (prepareOffline && repoDir) {
      prepareOfflineWorkspace(repoDir);
    }

    let executablePath = process.env.VSCODE_EXECUTABLE_PATH;
    if (!executablePath) {
      if (getOSInfo() === 'linux') {
        executablePath = '/usr/share/code/code';
      } else {
        throw new Error('VSCODE_EXECUTABLE_PATH env variable not provided');
      }
    }

    if (!process.env.CORE_VSIX_FILE_PATH && !process.env.CORE_VSIX_DOWNLOAD_URL) {
      args.push(
        `--extensionDevelopmentPath=${path.resolve(__dirname, '../../../vscode/core')}`,
        `--extensionDevelopmentPath=${path.resolve(__dirname, '../../../vscode/java')}`,
        `--extensionDevelopmentPath=${path.resolve(__dirname, '../../../vscode/javascript')}`,
        `--extensionDevelopmentPath=${path.resolve(__dirname, '../../../vscode/go')}`,
        `--extensionDevelopmentPath=${path.resolve(__dirname, '../../../vscode/csharp')}`,
        `--enable-proposed-api=${extensionId}`
      );
      console.log('Running in DEV mode...');
    }

    console.log(`Code command: ${executablePath} ${args.join(' ')}`);

    const vscodeApp = await electron.launch({
      executablePath: executablePath,
      args,
      env: {
        ...process.env,
        __TEST_EXTENSION_END_TO_END__: 'true',
      },
    });
    await vscodeApp.firstWindow();
    const window = await vscodeApp.firstWindow({ timeout: 60000 });
    console.log('VSCode opened');
    const vscode = new VSCodeDesktop(vscodeApp, window, repoDir, branch);

    if (waitForInitialization) {
      // Wait for extension initialization
      // Extensions will activate automatically via workspaceContains activation events
      await vscode.waitForExtensionInitialization();
    }

    return vscode;
  }

  /**
   * launches VSCode with KAI plugin installed and repoUrl app opened.
   * @param repoUrl
   * @param repoDir path to repo
   * @param branch optional branch to clone from
   * @param prepareOffline if true, extracts LLM cache and sets demoMode/cacheDir before VS Code launches
   */
  public static async init(
    repoUrl?: string,
    repoDir?: string,
    branch?: string,
    prepareOffline = false
  ): Promise<VSCode> {
    try {
      if (process.env.CORE_VSIX_FILE_PATH || process.env.CORE_VSIX_DOWNLOAD_URL) {
        await installExtension();
      }

      try {
        if (!isExtensionInstalled(redhatJavaExtensionId)) {
          if (process.env.CI) {
            console.warn(
              `Warning: Could not verify ${redhatJavaExtensionId} extension in CI environment`
            );
            console.warn(
              'This may be due to VS Code/Node.js compatibility issues, continuing anyway'
            );
          } else {
            throw new Error(
              `Required extension \`${redhatJavaExtensionId}\` was not found. It should have been installed automatically as a dependency`
            );
          }
        }
      } catch (error: any) {
        if (process.env.CI) {
          console.warn('Warning: Extension verification failed in CI environment:', error.message);
          console.warn(`Continuing with assumption that ${redhatJavaExtensionId} is available`);
        } else {
          throw error;
        }
      }

      return repoUrl
        ? VSCodeDesktop.open(repoUrl, repoDir, branch, true, prepareOffline)
        : VSCodeDesktop.open();
    } catch (error) {
      console.error('Error launching VSCode:', error);
      throw error;
    }
  }

  public async closeVSCode(): Promise<void> {
    try {
      if (this.app) {
        await this.app.close();
        console.log('VSCode closed successfully.');
      }
    } catch (error) {
      console.error('Error closing VSCode:', error);
    }
  }

  /**
   * Waits for the Konveyor extension to complete initialization by watching for
   * the __JAVA_EXTENSION_INITIALIZED__ info message signal.
   * Since the Java extension waits for the core extension to activate before completing,
   * this signal guarantees that both core and Java extensions are fully ready.
   */
  public async waitForExtensionInitialization(): Promise<void> {
    try {
      const javaReadySelector = this.getWindow().getByRole('button', { name: 'Java: Ready' });

      await javaReadySelector.waitFor({ timeout: 120000 });
      // Sometimes the java ready status is displayed for a few seconds before starting to load again
      // This checks that the state is kept for a few seconds before continuing
      await this.waitDefault();
      await javaReadySelector.waitFor({ timeout: 1200000 });

      // Trigger extension activation by opening the analysis view
      await this.executeQuickCommand(`${VSCode.COMMAND_CATEGORY}: Open Analysis View`);

      // Wait for Java extension initialization signal
      // The Java extension waits for core to activate, so this signal means both are ready
      // This is a persistent status bar item, so we can just wait for it to appear
      const javaInitStatusBar = this.window.getByText('__JAVA_EXTENSION_INITIALIZED__');
      await expect(javaInitStatusBar).toBeVisible({ timeout: 300_000 }); // 5 minute timeout
    } catch (error) {
      console.error('Failed to wait for extension initialization:', error);
      throw error;
    }
  }

  protected async selectCustomRules(customRulesPath: string) {
    const manageProfileView = await this.getView(KAIViews.manageProfiles);
    console.log(`Selecting custom rules from: ${customRulesPath}`);

    // Convert relative path to absolute path
    // First try relative to repo directory (for workspacePath scenarios like C#)
    // Then fall back to tests directory (for other scenarios)
    let absoluteRulesPath: string;
    if (path.isAbsolute(customRulesPath)) {
      absoluteRulesPath = customRulesPath;
    } else if (this.repoDir) {
      // For repos with workspacePath, resolve relative to repo root
      // repoDir might be "repoName" or "repoName/workspacePath" or "repoName\\workspacePath" (Windows)
      // Use regex to handle both forward slashes (Unix/Mac) and backslashes (Windows)
      // This is necessary because fixture values use forward slashes even on Windows
      const repoRoot = this.repoDir.split(/[\\/]/)[0];
      const testsDir = path.resolve(__dirname, '..', '..');
      const repoRootPath = path.resolve(testsDir, repoRoot);
      const rulesPath = path.resolve(repoRootPath, customRulesPath);

      // Check if path exists relative to repo root
      if (fs.existsSync(rulesPath)) {
        absoluteRulesPath = rulesPath;
      } else {
        // Fall back to tests directory
        const fallbackPath = path.resolve(testsDir, customRulesPath);
        absoluteRulesPath = fallbackPath;
      }
    } else {
      // Fall back to tests directory
      const testsDir = path.resolve(__dirname, '..', '..');
      absoluteRulesPath = path.resolve(testsDir, customRulesPath);
    }
    console.log(`Resolved custom rules path: ${absoluteRulesPath}`);

    const customRulesButton = manageProfileView.getByRole('button', {
      name: 'Select Custom Rules…',
    });

    if (await customRulesButton.isVisible()) {
      await stubDialog(this.app, 'showOpenDialog', {
        filePaths: [absoluteRulesPath],
        canceled: false,
      });

      await customRulesButton.click();

      const folderName = path.basename(customRulesPath);
      console.log(
        `Waiting for custom rules label with folder name: "${folderName}" from path: "${customRulesPath}"`
      );

      const customRulesLabel = manageProfileView
        .locator('[class*="label"], [class*="Label"]')
        .filter({ hasText: folderName });
      await expect(customRulesLabel.first()).toBeVisible({ timeout: 30000 });
      console.log(`Custom rules label for "${folderName}" is now visible`);
    }
  }

  /**
   * Unzips all test data into workspace .vscode/ directory, only deletes the zip files if cleanup is true
   * @param cleanup
   */
  public async ensureLLMCache(cleanup: boolean = false): Promise<void> {
    try {
      const wspacePath = this.llmCachePaths().workspacePath;
      const storedPath = this.llmCachePaths().storedPath;
      if (fs.existsSync(wspacePath)) {
        fs.rmSync(wspacePath, { recursive: true, force: true });
      }
      if (cleanup) {
        return;
      }
      if (!fs.existsSync(wspacePath)) {
        fs.mkdirSync(wspacePath, { recursive: true });
      }
      if (!fs.existsSync(storedPath)) {
        console.info('No local cache file found');
        return;
      }
      // move stored zip to workspace
      extractZip(storedPath, wspacePath);
    } catch (error) {
      console.error('Error unzipping test data:', error);
      throw error;
    }
  }

  /**
   * Copies all newly generated LLM cache data into a zip file in the repo, merges with the existing data
   * This will be used when we want to generate a new cache data
   */
  public async updateLLMCache() {
    const newCacheZip = path.join(path.dirname(this.llmCachePaths().storedPath), 'new.zip');
    createZip(this.llmCachePaths().workspacePath, newCacheZip);
    fs.renameSync(newCacheZip, this.llmCachePaths().storedPath);
    fs.renameSync(`${newCacheZip}.metadata`, `${this.llmCachePaths().storedPath}.metadata`);
  }

  public async pasteContent(content: string) {
    await this.app.evaluate(({ clipboard }, content) => {
      clipboard.writeText(content);
    }, content);
    const modifier = getOSInfo() === 'macOS' ? 'Meta' : 'Control';
    await this.window.keyboard.press(`${modifier}+v`, { delay: 500 });
  }

  public getWindow(): Page {
    if (!this.window) {
      throw new Error('VSCode window is not initialized.');
    }
    return this.window;
  }

  public async ensureDebugArchive() {
    if (!this.repoDir) {
      throw new Error('repodir is required in VscodeDesktop.ensureDebugArchive');
    }
    const zipPath = path.join(this.repoDir, '.vscode', 'debug-archive.zip');
    const zipStat = await fsPromises.stat(zipPath);
    expect(zipStat.isFile()).toBe(true);
    const extractedPath = path.join(this.repoDir, '.vscode');
    extractZip(zipPath, extractedPath);
    const logsPath = path.join(extractedPath, 'logs', 'extension.log');
    const logsStat = await fsPromises.stat(logsPath);
    expect(logsStat.isFile()).toBe(true);
  }
}
