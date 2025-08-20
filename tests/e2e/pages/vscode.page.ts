import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { _electron as electron, FrameLocator } from 'playwright';
import { ElectronApplication, expect, Page } from '@playwright/test';

import { createZip, extractZip } from '../utilities/archive';
import { cleanupRepo, generateRandomString, getOSInfo } from '../utilities/utils';
import { LeftBarItems } from '../enums/left-bar-items.enum';
import { DEFAULT_PROVIDER } from '../fixtures/provider-configs.fixture';
import { KAIViews } from '../enums/views.enum';
import { TEST_DATA_DIR } from '../utilities/consts';
import { BasePage } from './base.page';
import { installExtension } from '../utilities/vscode-commands.utils';
import { FixTypes } from '../enums/fix-types.enum';

export class VSCode extends BasePage {
  constructor(
    app: ElectronApplication,
    window: Page,
    private readonly repoDir?: string
  ) {
    super(app, window);
  }

  public static async open(repoUrl?: string, repoDir?: string) {
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
        console.log(`Cloning repository from ${repoUrl}`);
        execSync(`git clone ${repoUrl}`);
      }
    } catch (error: any) {
      throw new Error('Failed to clone the repository');
    }

    if (repoDir) {
      args.push(path.resolve(repoDir));
    }

    let executablePath = process.env.VSCODE_EXECUTABLE_PATH;
    if (!executablePath) {
      if (getOSInfo() === 'linux') {
        executablePath = '/usr/share/code/code';
      } else {
        throw new Error('VSCODE_EXECUTABLE_PATH env variable not provided');
      }
    }

    if (!process.env.VSIX_FILE_PATH && !process.env.VSIX_DOWNLOAD_URL) {
      args.push(
        `--extensionDevelopmentPath=${path.resolve(__dirname, '../../../vscode')}`,
        '--enable-proposed-api=konveyor.konveyor-ai'
      );
      console.log('Running in DEV mode...');
    }

    console.log(`Code command: ${executablePath} ${args.join(' ')}`);

    const vscodeApp = await electron.launch({
      executablePath: executablePath,
      args,
    });
    await vscodeApp.firstWindow();

    const window = await vscodeApp.firstWindow({ timeout: 60000 });
    console.log('VSCode opened');
    return new VSCode(vscodeApp, window, repoDir);
  }

  /**
   * launches VSCode with KAI plugin installed and repoUrl app opened.
   * @param repoUrl
   * @param repoDir path to repo
   */
  public static async init(repoUrl?: string, repoDir?: string): Promise<VSCode> {
    try {
      if (process.env.VSIX_FILE_PATH || process.env.VSIX_DOWNLOAD_URL) {
        await installExtension();
      }

      return repoUrl ? VSCode.open(repoUrl, repoDir) : VSCode.open();
    } catch (error) {
      console.error('Error launching VSCode:', error);
      throw error;
    }
  }

  /**
   * Closes the VSCode instance.
   */
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

  public async executeQuickCommand(command: string) {
    await this.waitDefault();
    const modifier = getOSInfo() === 'macOS' ? 'Meta' : 'Control';
    await this.window.keyboard.press(`${modifier}+Shift+P`, { delay: 500 });
    const input = this.window.getByPlaceholder('Type the name of a command to run.');
    await input.fill(`>${command}`);
    await expect(
      this.window.locator(`a.label-name span.highlight >> text="${command}"`)
    ).toBeVisible();

    await input.press('Enter', { delay: 500 });
  }

  public async openLeftBarElement(name: LeftBarItems) {
    const window = this.getWindow();

    const navLi = window.locator(`a[aria-label^="${name}"]`).locator('..');

    if (await navLi.isVisible()) {
      if ((await navLi.getAttribute('aria-expanded')) === 'false') {
        await navLi.click();
      }
      return;
    }

    const moreButton = window.getByRole('button', { name: LeftBarItems.AdditionalViews }).first();
    await expect(moreButton).toBeVisible();
    await moreButton.click();

    const menuBtn = window.locator(`a.action-menu-item span[aria-label^="${name}"]`);
    await expect(menuBtn).toBeVisible();
    await menuBtn.click({ delay: 500 });
  }

  public async openAnalysisView(): Promise<void> {
    // Try using command palette first - this works reliably when extension is hidden due to too many extensions
    try {
      await this.executeQuickCommand('Konveyor: Open Konveyor Analysis View');
      return;
    } catch (error) {
      // Fallback to activity bar approach
      await this.openLeftBarElement(LeftBarItems.Konveyor);
    }

    await this.window.getByText('Konveyor Issues').dblclick();

    await this.window.locator('a[aria-label="Open Konveyor Analysis View"]').click();
  }

  public async startServer(): Promise<void> {
    await this.openAnalysisView();
    const analysisView = await this.getView(KAIViews.analysisView);
    if (!(await analysisView.getByRole('button', { name: 'Stop' }).isVisible())) {
      await analysisView.getByRole('button', { name: 'Start' }).click({ delay: 500 });
      await analysisView.getByRole('button', { name: 'Stop' }).isEnabled({ timeout: 120000 });
    }
  }

  public async searchViolation(term: string): Promise<void> {
    const analysisView = await this.getView(KAIViews.analysisView);

    const toggleFilterButton = analysisView.locator('button[aria-label="Show Filters"]');
    const searchInput = analysisView.locator('input[aria-label="Search violations and incidents"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill(term);
      return;
    }

    await toggleFilterButton.click();
    await searchInput.fill(term);
    await toggleFilterButton.click();
  }

  public async runAnalysis() {
    await this.window.waitForTimeout(15000);
    const analysisView = await this.getView(KAIViews.analysisView);
    const runAnalysisBtnLocator = analysisView.getByRole('button', {
      name: 'Run Analysis',
    });
    await expect(runAnalysisBtnLocator).toBeEnabled({ timeout: 600000 });

    await runAnalysisBtnLocator.click();
    await expect(analysisView.getByText('Analysis Progress').first()).toBeVisible({
      timeout: 10000,
    });
  }

  public async getView(view: KAIViews): Promise<FrameLocator> {
    await this.window.locator(`div.tab.active[aria-label="${view}"]`).waitFor();
    await this.executeQuickCommand('View: Close Other Editors in Group');

    const iframes = this.window.locator('iframe');
    const count = await iframes.count();

    for (let i = 0; i < count; i++) {
      const outerFrameLocator = this.window.frameLocator('iframe').nth(i);
      const innerFrameLocator = outerFrameLocator.getByTitle(view);

      if ((await innerFrameLocator.count()) === 1) {
        return innerFrameLocator.contentFrame();
      }
    }

    throw new Error(`Iframe ${view} not found`);
  }

  public async configureGenerativeAI(config: string = DEFAULT_PROVIDER.config) {
    await this.executeQuickCommand('Konveyor: Open the GenAI model provider configuration file');
    const modifier = getOSInfo() === 'macOS' ? 'Meta' : 'Control';
    await this.window.keyboard.press(`${modifier}+a+Delete`);
    await this.pasteContent(config);
    await this.window.keyboard.press(`${modifier}+s`, { delay: 500 });
  }

  public async createProfile(sources: string[], targets: string[], profileName?: string) {
    await this.executeQuickCommand('Konveyor: Manage Analysis Profile');

    const manageProfileView = await this.getView(KAIViews.manageProfiles);
    // TODO ask for/add test-id for this button and comboboxes
    await manageProfileView.getByRole('button', { name: '+ New Profile' }).click();

    const randomName = generateRandomString();
    const nameToUse = profileName ? profileName : randomName;
    await manageProfileView.getByRole('textbox', { name: 'Profile Name' }).fill(nameToUse);

    // Select Targets
    const targetsInput = manageProfileView
      .getByRole('combobox', { name: 'Type to filter' })
      .first();
    await targetsInput.click({ delay: 500 });

    for (const target of targets) {
      await targetsInput.fill(target);
      await manageProfileView
        .getByRole('option', { name: target, exact: true })
        .click({ timeout: 5000 });
    }
    await this.window.keyboard.press('Escape');

    // Select Source
    const sourceInput = manageProfileView.getByRole('combobox', { name: 'Type to filter' }).nth(1);
    await sourceInput.click({ delay: 500 });

    for (const source of sources) {
      await sourceInput.fill(source);
      await manageProfileView
        .getByRole('option', { name: source, exact: true })
        .click({ timeout: 5000 });
    }
    await this.window.keyboard.press('Escape');
  }

  public async deleteProfile(profileName: string) {
    await this.executeQuickCommand('Konveyor: Manage Analysis Profile');
    const manageProfileView = await this.getView(KAIViews.manageProfiles);
    const profileList = manageProfileView.getByRole('list', {
      name: 'Profile list',
    });
    await profileList.waitFor({ state: 'visible', timeout: 5000 });

    const profileItems = profileList.getByRole('listitem');
    try {
      await profileItems.filter({ hasText: profileName }).click({ timeout: 5000 });
      await manageProfileView.getByRole('button', { name: 'Delete Profile' }).click();
      const confirmButton = manageProfileView
        .getByRole('dialog', { name: 'Delete profile?' })
        .getByRole('button', { name: 'Confirm' });
      await confirmButton.click();
      await manageProfileView
        .getByRole('listitem')
        .filter({ hasText: profileName })
        .waitFor({ state: 'hidden', timeout: 10000 });
    } catch (error) {
      console.log('Error deleting profile:', error);
      throw error;
    }
  }

  public async searchAndRequestFix(searchTerm: string, fixType: FixTypes) {
    const analysisView = await this.getView(KAIViews.analysisView);
    await this.searchViolation(searchTerm);
    await analysisView.locator('div.pf-v6-c-card__header-toggle').nth(0).click();
    await analysisView.locator('button#get-solution-button').nth(fixType).click();
  }

  /**
   * Unzips all test data into workspace .vscode/ directory, deletes the zip files if cleanup is true
   */
  public async ensureLLMCache(cleanup: boolean = false): Promise<void> {
    try {
      const wspacePath = this.llmCachePaths().workspacePath;
      const storedPath = this.llmCachePaths().storedPath;
      if (cleanup) {
        if (fs.existsSync(wspacePath)) {
          fs.rmSync(wspacePath, { recursive: true, force: true });
        }
        return;
      }
      if (!fs.existsSync(wspacePath)) {
        fs.mkdirSync(wspacePath, { recursive: true });
      }
      if (!fs.existsSync(storedPath)) {
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

  private llmCachePaths(): {
    storedPath: string; // this is where the data is checked-in in the repo
    workspacePath: string; // this is where a workspace is expecting to find cached data
  } {
    return {
      storedPath: path.join(__dirname, '..', '..', 'data', 'llm_cache.zip'),
      workspacePath: path.join(this.repoDir ?? '', '.vscode', 'cache'),
    };
  }

  /**
   * Writes or updates the VSCode settings.json file to current workspace @ .vscode/settings.json
   * @param settings - Key - value pair of settings to write or update, if a setting already exists, the new values will be merged
   */
  public async writeOrUpdateVSCodeSettings(settings: Record<string, any>): Promise<void> {
    try {
      const vscodeDir = path.join(this.repoDir ?? '', '.vscode');
      const settingsPath = path.join(vscodeDir, 'settings.json');
      if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
      }
      let existingSettings: Record<string, any> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          const existingContent = fs.readFileSync(settingsPath, 'utf-8');
          existingSettings = JSON.parse(existingContent);
        } catch (parseError) {
          console.warn(
            `Failed to parse existing settings.json, starting with empty settings: ${parseError}`
          );
          existingSettings = {};
        }
      }
      const mergedSettings = { ...existingSettings, ...settings };
      fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');
    } catch (error) {
      console.error('Error writing VSCode settings:', error);
      throw error;
    }
  }
}
