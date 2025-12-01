import * as fs from 'fs';
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
import { extensionId } from '../utilities/utils';
import { VSCode } from './vscode.page';

export class VSCodeDesktop extends VSCode {
  protected readonly app: ElectronApplication;
  protected window: Page;

  constructor(app: ElectronApplication, window: Page, repoDir?: string) {
    super();
    this.app = app;
    this.window = window;
    this.repoDir = repoDir;
  }

  public static async open(
    repoUrl?: string,
    repoDir?: string,
    branch = 'main',
    waitForInitialization = true
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
        if (repoDir) {
          await cleanupRepo(repoDir);
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

    // set the log level prior to starting vscode
    writeOrUpdateSettingsJson(path.join(repoDir ?? '', '.vscode', 'settings.json'), {
      'konveyor.logLevel': 'silly',
    });

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
        `--extensionDevelopmentPath=${path.resolve(__dirname, '../../../vscode')}`,
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
    const screenSize = await window.evaluate(() => ({
      width: screen.width,
      height: screen.height,
    }));
    await window.setViewportSize(screenSize);
    console.log('VSCode opened');
    const vscode = new VSCodeDesktop(vscodeApp, window, repoDir);

    if (waitForInitialization) {
      // Open Java file immediately after VSCode starts to trigger onLanguage:java activation
      if (repoDir) {
        await vscode.openJavaFileForActivation();
      }
      // Wait for extension initialization in downstream environment
      await vscode.waitForExtensionInitialization();
    }

    return vscode;
  }

  /**
   * launches VSCode with KAI plugin installed and repoUrl app opened.
   * @param repoUrl
   * @param repoDir path to repo
   * @param branch optional branch to clone from
   */
  public static async init(repoUrl?: string, repoDir?: string, branch?: string): Promise<VSCode> {
    try {
      if (process.env.CORE_VSIX_FILE_PATH || process.env.CORE_VSIX_DOWNLOAD_URL) {
        await installExtension();
      }

      try {
        if (!isExtensionInstalled('redhat.java')) {
          if (process.env.CI) {
            console.warn('Warning: Could not verify redhat.java extension in CI environment');
            console.warn(
              'This may be due to VS Code/Node.js compatibility issues, continuing anyway'
            );
          } else {
            throw new Error(
              'Required extension `redhat.java` was not found. It should have been installed automatically as a dependency'
            );
          }
        }
      } catch (error: any) {
        if (process.env.CI) {
          console.warn('Warning: Extension verification failed in CI environment:', error.message);
          console.warn('Continuing with assumption that redhat.java is available');
        } else {
          throw error;
        }
      }

      return repoUrl ? VSCodeDesktop.open(repoUrl, repoDir, branch, false) : VSCodeDesktop.open();
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
   * Opens a Java file to trigger onLanguage:java activation for both redhat.java and konveyor-java
   */
  public async openJavaFileForActivation(): Promise<void> {
    try {
      console.log('Opening Java file to trigger Java extension activation...');

      // Wait for VSCode to be fully ready before executing commands
      await this.waitDefault();
      await this.window.waitForTimeout(3000);

      await this.window.locator('body').focus();
      await this.waitDefault();

      const javaFilePath = path.resolve(
        this.repoDir || '',
        'src/main/java/com/redhat/coolstore/service/OrderService.java'
      );

      if (!fs.existsSync(javaFilePath)) {
        throw new Error(
          `Java file not found at ${javaFilePath}. Cannot trigger Java extension activation.`
        );
      }

      await stubDialog(this.app, 'showOpenDialog', {
        filePaths: [javaFilePath],
        canceled: false,
      });
      await this.executeQuickCommand('File: Open File...');
      await this.waitDefault();

      // Verify file opened
      const fileName = 'OrderService.java';
      const editorTab = this.window.locator(`div.tab[aria-label*="${fileName}"]`);
      await expect(editorTab).toBeVisible({ timeout: 10000 });
      console.log(`Java file opened successfully: ${fileName}`);
    } catch (error) {
      console.error('Failed to open Java file for activation:', error);
      throw error;
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
      console.log('Waiting for Konveyor extension initialization...');

      const javaReadySelector = this.getWindow().getByRole('button', { name: 'Java: Ready' });

      await javaReadySelector.waitFor({ timeout: 120000 });
      // Sometimes the java ready status is displayed for a few seconds before starting to load again
      // This checks that the state is kept for a few seconds before continuing
      await this.waitDefault();
      await javaReadySelector.waitFor({ timeout: 1200000 });

      // Trigger extension activation by opening the analysis view
      console.log('Opening Analysis View to trigger core extension activation...');
      await this.executeQuickCommand(`${VSCode.COMMAND_CATEGORY}: Open Analysis View`);

      // Wait for Java extension initialization signal
      // The Java extension waits for core to activate, so this signal means both are ready
      // This is a persistent status bar item, so we can just wait for it to appear
      console.log('Waiting for Java extension initialization signal...');

      const javaInitStatusBar = this.window.getByText('__JAVA_EXTENSION_INITIALIZED__');
      await expect(javaInitStatusBar).toBeVisible({ timeout: 300_000 }); // 5 minute timeout

      console.log('Konveyor extensions initialized successfully');
    } catch (error) {
      console.error('Failed to wait for extension initialization:', error);
      throw error;
    }
  }

  protected async selectCustomRules(customRulesPath: string) {
    const manageProfileView = await this.getView(KAIViews.manageProfiles);
    console.log(`Selecting custom rules from: ${customRulesPath}`);

    const customRulesButton = manageProfileView.getByRole('button', {
      name: 'Select Custom Rules…',
    });

    if (await customRulesButton.isVisible()) {
      await stubDialog(this.app, 'showOpenDialog', {
        filePaths: [customRulesPath],
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
}
