import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { _electron as electron, FrameLocator } from 'playwright';
import { ElectronApplication, expect, Page } from '@playwright/test';
import { MIN, SEC } from '../utilities/consts';
import { createZip, extractZip } from '../utilities/archive';
import { cleanupRepo, generateRandomString, getOSInfo } from '../utilities/utils';
import { LeftBarItems } from '../enums/left-bar-items.enum';
import { DEFAULT_PROVIDER } from '../fixtures/provider-configs.fixture';
import { KAIViews } from '../enums/views.enum';
import { TEST_DATA_DIR } from '../utilities/consts';
import { BasePage } from './base.page';
import { installExtension } from '../utilities/vscode-commands.utils';
import { FixTypes } from '../enums/fix-types.enum';
import { stubDialog } from 'electron-playwright-helpers';
import { extensionId } from '../utilities/utils';

type SortOrder = 'ascending' | 'descending';
type ListKind = 'issues' | 'files';
export class VSCode extends BasePage {
  constructor(
    app: ElectronApplication,
    window: Page,
    private readonly repoDir?: string
  ) {
    super(app, window);
  }

  public static async open(repoUrl?: string, repoDir?: string, branch = 'main') {
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
        execSync(`git clone ${repoUrl} -b ${branch}`);
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
        `--enable-proposed-api=${extensionId}`
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
   * @param branch optional branch to clone from
   */
  public static async init(repoUrl?: string, repoDir?: string, branch?: string): Promise<VSCode> {
    try {
      if (process.env.VSIX_FILE_PATH || process.env.VSIX_DOWNLOAD_URL) {
        await installExtension();
      }

      return repoUrl ? VSCode.open(repoUrl, repoDir, branch) : VSCode.open();
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

    try {
      // Check if server is already running
      const stopButton = analysisView.getByRole('button', { name: 'Stop' });
      const isServerRunning = await stopButton.isVisible();

      if (!isServerRunning) {
        console.log('Starting server...');
        const startButton = analysisView.getByRole('button', { name: 'Start' });
        await startButton.waitFor({ state: 'visible', timeout: 10000 });
        await startButton.click({ delay: 500 });

        // Wait for server to start (Stop button becomes enabled)
        await stopButton.waitFor({ state: 'visible', timeout: 180000 });
        await stopButton.isEnabled({ timeout: 180000 });
        console.log('Server started successfully');
      } else {
        console.log('Server is already running');
      }
    } catch (error) {
      console.log('Error starting server:', error);
      throw error;
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

    try {
      // Ensure server is running before attempting analysis
      const stopButton = analysisView.getByRole('button', { name: 'Stop' });
      await expect(stopButton).toBeVisible({ timeout: 30000 });

      const runAnalysisBtnLocator = analysisView.getByRole('button', {
        name: 'Run Analysis',
      });

      console.log('Waiting for Run Analysis button to be enabled...');
      await expect(runAnalysisBtnLocator).toBeEnabled({ timeout: 600000 });

      console.log('Starting analysis...');
      await runAnalysisBtnLocator.click();

      console.log('Waiting for analysis progress indicator...');
      await expect(analysisView.getByText('Analysis Progress').first()).toBeVisible({
        timeout: 60000,
      });
      console.log('Analysis started successfully');
    } catch (error) {
      console.log('Error running analysis:', error);
      throw error;
    }
  }

  /**
   * Sets the list kind (issues or files) and sort order (ascending or descending) in the analysis view.
   * @param kind - The kind of list to display ('issues' or 'files').
   * @param order - The sort order ('ascending' or 'descending').
   */
  public async setListKindAndSort(kind: ListKind, order: SortOrder): Promise<void> {
    const analysisView = await this.getView(KAIViews.analysisView);
    const kindButton = analysisView.getByRole('button', {
      name: kind === 'issues' ? 'Issues' : 'Files',
    });

    await expect(kindButton).toBeVisible({ timeout: 5_000 });
    await expect(kindButton).toBeEnabled({ timeout: 3_000 });
    await kindButton.click();
    await expect(kindButton).toHaveAttribute('aria-pressed', 'true');
    const sortButton = analysisView.getByRole('button', {
      name: order === 'ascending' ? 'Sort ascending' : 'Sort descending',
    });
    await expect(sortButton).toBeVisible({ timeout: 3_000 });
    await sortButton.click();
    await expect(sortButton).toHaveAttribute('aria-pressed', 'true');
  }

  /**
   * Retrieves the names of items (issues or files) currently listed in the analysis view.
   * @param _ - The kind of list ('issues' or 'files').
   * @returns A promise that resolves to an array of item names.
   */
  async getListNames(_: ListKind): Promise<string[]> {
    const view = await this.getView(KAIViews.analysisView);
    const listCards = view
      .locator('[data-ouia-component-type="PF6/Card"]')
      .filter({ has: view.getByRole('heading', { level: 3 }) })
      .filter({ has: view.getByRole('button', { name: /get solution/i }) });
    const titles = listCards.getByRole('heading', { level: 3 });
    await expect(titles.first()).toBeVisible({ timeout: 6_000 });

    const texts = await titles.allInnerTexts();
    return texts.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  /**
   * Opens the category filter dropdown in the analysis view and returns its elements.
   * @returns An object containing the category button, menu, and options locators.
   */
  public async openCategory() {
    const view = await this.getView(KAIViews.analysisView);
    const categoryBtn = view.getByRole('button', { name: /^Category(?:\s*\d+)?$/i });
    await categoryBtn.scrollIntoViewIfNeeded();

    await categoryBtn.click();
    await expect(categoryBtn).toHaveAttribute('aria-expanded', 'true', { timeout: 3000 });

    const options = view.locator(
      '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"]'
    );

    await expect(options.first()).toBeVisible({ timeout: 6000 });

    return { categoryBtn, options };
  }

  /**
   * Selects a category by its name or RegExp in the category filter dropdown in the analysis view.
   * @param name - The name or RegExp of the category to select.
   */
  public async setCategoryByName(name: string | RegExp): Promise<void> {
    const { categoryBtn, options } = await this.openCategory();
    const toRegex = (s: string) =>
      new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');

    const opt =
      typeof name === 'string'
        ? options.filter({ hasText: toRegex(name) }).first()
        : options.filter({ hasText: name as RegExp }).first();
    await expect(opt).toBeVisible({ timeout: 5000 });
    await opt.click();

    if ((await categoryBtn.getAttribute('aria-expanded')) === 'true') {
      await categoryBtn.click();
    }
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

  public async createProfile(
    sources: string[],
    targets: string[],
    profileName?: string,
    customRulesPath?: string
  ) {
    await this.executeQuickCommand('Konveyor: Manage Analysis Profile');

    const manageProfileView = await this.getView(KAIViews.manageProfiles);

    await manageProfileView.getByRole('button', { name: '+ New Profile' }).click();

    const randomName = generateRandomString();
    const nameToUse = profileName ? profileName : randomName;
    await manageProfileView.getByRole('textbox', { name: 'Profile Name' }).fill(nameToUse);

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

    const sourceInput = manageProfileView.getByRole('combobox', { name: 'Type to filter' }).nth(1);
    await sourceInput.click({ delay: 500 });

    for (const source of sources) {
      await sourceInput.fill(source);
      await manageProfileView
        .getByRole('option', { name: source, exact: true })
        .click({ timeout: 5000 });
    }
    await this.window.keyboard.press('Escape');

    // Select Custom Rules if provided
    if (customRulesPath) {
      console.log(`Creating profile with custom rules from: ${customRulesPath}`);

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
    return nameToUse;
  }

  public async deleteProfile(profileName: string) {
    try {
      console.log(`Attempting to delete profile: ${profileName}`);
      await this.executeQuickCommand('Konveyor: Manage Analysis Profile');
      const manageProfileView = await this.getView(KAIViews.manageProfiles);

      const profileList = manageProfileView.getByRole('list', {
        name: 'Profile list',
      });
      await profileList.waitFor({ state: 'visible', timeout: 30000 });

      const profileItems = profileList.getByRole('listitem');
      const targetProfile = profileItems.filter({ hasText: profileName });

      // Check if profile exists before attempting to delete
      const profileCount = await targetProfile.count();
      if (profileCount === 0) {
        console.log(`Profile '${profileName}' not found in the list`);
        return; // Profile doesn't exist, nothing to delete
      }

      console.log(`Found profile '${profileName}', proceeding with deletion`);
      await targetProfile.click({ timeout: 30000 });

      const deleteButton = manageProfileView.getByRole('button', { name: 'Delete Profile' });
      await deleteButton.waitFor({ state: 'visible', timeout: 10000 });
      await deleteButton.click();

      const confirmButton = manageProfileView
        .getByRole('dialog', { name: 'Delete profile?' })
        .getByRole('button', { name: 'Confirm' });
      await confirmButton.waitFor({ state: 'visible', timeout: 10000 });
      await confirmButton.click();

      // Wait for profile to be removed from the list
      await manageProfileView
        .getByRole('listitem')
        .filter({ hasText: profileName })
        .waitFor({ state: 'hidden', timeout: 15000 });

      console.log(`Profile '${profileName}' deleted successfully`);
    } catch (error) {
      console.log('Error deleting profile:', error);
      // Check if the profile still exists after error
      try {
        const manageProfileView = await this.getView(KAIViews.manageProfiles);
        const profileList = manageProfileView.getByRole('list', { name: 'Profile list' });
        const profileItems = profileList.getByRole('listitem');
        const remainingProfile = profileItems.filter({ hasText: profileName });
        const remainingCount = await remainingProfile.count();

        if (remainingCount === 0) {
          console.log(`Profile '${profileName}' was actually deleted despite the error`);
          return; // Profile was deleted successfully despite the error
        }
      } catch (checkError) {
        console.log('Could not verify profile deletion:', checkError);
      }
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
  public async waitForSolutionConfirmation(): Promise<void> {
    const analysisView = await this.getView(KAIViews.analysisView);
    const solutionButton = analysisView.locator('button#get-solution-button');
    const backdrop = analysisView.locator('div.pf-v6-c-backdrop');

    // Wait for both conditions to be true concurrently
    await Promise.all([
      // 1. Wait for the button to be enabled (color is back to default)
      expect(solutionButton.first()).not.toBeDisabled({ timeout: 3600000 }),

      // 2. Wait for the blocking overlay to disappear
      expect(backdrop).not.toBeVisible({ timeout: 3600000 }),
    ]);
  }

  public async acceptAllSolutions() {
    const resolutionView = await this.getView(KAIViews.resolutionDetails);
    const fixLocator = resolutionView.locator('button[aria-label="Accept all changes"]');

    await this.waitDefault();
    await expect(fixLocator.first()).toBeVisible({ timeout: 3600000 });

    const fixesNumber = await fixLocator.count();
    let fixesCounter = await fixLocator.count();
    for (let i = 0; i < fixesNumber; i++) {
      await expect(fixLocator.first()).toBeVisible({ timeout: 30000 });
      // Ensures the button is clicked even if there are notifications overlaying it due to screen size
      await fixLocator.first().dispatchEvent('click');
      await this.waitDefault();
      expect(await fixLocator.count()).toEqual(--fixesCounter);
    }
  }

  public async searchViolationAndAcceptAllSolutions(violation: string) {
    await this.searchAndRequestFix(violation, FixTypes.Issue);
    await this.acceptAllSolutions();
  }
}
