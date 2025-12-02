import { FrameLocator } from 'playwright';
import { expect, Page } from '@playwright/test';
import { generateRandomString, getOSInfo } from '../utilities/utils';
import { DEFAULT_PROVIDER } from '../fixtures/provider-configs.fixture';
import { KAIViews } from '../enums/views.enum';
import { FixTypes } from '../enums/fix-types.enum';
import { ProfileActions } from '../enums/profile-action-types.enum';
import path from 'path';
import { VSCodeDesktop } from './vscode-desktop.page';

type SortOrder = 'ascending' | 'descending';
type ListKind = 'issues' | 'files';

export abstract class VSCode {
  protected repoDir?: string;
  protected branch?: string;
  protected abstract window: Page;
  public static readonly COMMAND_CATEGORY = process.env.TEST_CATEGORY || 'Konveyor';

  /**
   * Unzips all test data into workspace .vscode/ directory, only deletes the zip files if cleanup is true
   */
  public abstract ensureLLMCache(cleanup: boolean): Promise<void>;
  public abstract updateLLMCache(): Promise<void>;
  protected abstract selectCustomRules(customRulesPath: string): Promise<void>;
  public abstract closeVSCode(): Promise<void>;
  public abstract pasteContent(content: string): Promise<void>;
  public abstract getWindow(): Page;

  protected llmCachePaths(): {
    storedPath: string; // this is where the data is checked-in in the repo
    workspacePath: string; // this is where a workspace is expecting to find cached data
  } {
    return {
      storedPath: path.join(__dirname, '..', '..', 'data', 'llm_cache.zip'),
      workspacePath: path.join(this.repoDir ?? '', '.vscode', 'cache'),
    };
  }

  public async executeQuickCommand(command: string) {
    console.log(`Executing command [${command}]`);
    await this.waitDefault();
    await this.window.locator('body').focus();
    const modifier = getOSInfo() === 'macOS' ? 'Meta' : 'Control';
    await this.window.keyboard.press(`${modifier}+Shift+P`, { delay: 500 });
    const input = this.window.getByPlaceholder('Type the name of a command to run.');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill(`>${command}`);
    await expect(
      this.window.locator(`a.label-name span.highlight >> text="${command}"`)
    ).toBeVisible();
    await input.press('Enter', { delay: 500 });
  }

  public async openLeftBarElement(name: string) {
    const window = this.getWindow();

    const navLi = window.locator(`a[aria-label^="${name}"]`).locator('..');

    if (await navLi.isVisible()) {
      if ((await navLi.getAttribute('aria-expanded')) === 'false') {
        await navLi.click();
      }
      return;
    }

    const moreButton = window.getByRole('button', { name: 'Additional Views' }).first();
    await expect(moreButton).toBeVisible();
    await moreButton.click();

    const menuBtn = window.locator(`a.action-menu-item span[aria-label^="${name}"]`);
    await expect(menuBtn).toBeVisible();
    await menuBtn.click({ delay: 500 });
  }

  public async openAnalysisView(): Promise<void> {
    // Try using command palette first - this works reliably when extension is hidden due to too many extensions
    try {
      await this.executeQuickCommand(`${VSCode.COMMAND_CATEGORY}: Open Analysis View`);
      return;
    } catch (error) {
      console.log('Command palette approach failed:', error);
    }

    // Fallback to activity bar approach
    try {
      await this.openLeftBarElement(VSCode.COMMAND_CATEGORY);
      await this.window.getByText(`${VSCode.COMMAND_CATEGORY} Issues`).dblclick();
      await this.window.locator(`a[aria-label*="Analysis View"]`).click();
    } catch (error) {
      console.log('Activity bar approach failed:', error);
      throw error;
    }
  }

  public async startServer(): Promise<void> {
    await this.openAnalysisView();
    const analysisView = await this.getView(KAIViews.analysisView);
    try {
      console.log('Checking server status');

      if (await this.isServerRunning()) {
        console.log('Server is already running');
        return;
      }

      if (this instanceof VSCodeDesktop) {
        console.log('Activating extensions before starting server...');
        await this.openJavaFileForActivation();
        await this.waitForExtensionInitialization();
        await this.getWindow().screenshot({
          path: `test-output/01-java-file-opened-again.png`,
          fullPage: true,
        });
        console.log('Screenshot saved: 01-java-file-opened-again.png');
      }

      console.log('Server is not running, starting server...');
      const startButton = analysisView.getByRole('button', { name: 'Start' });
      await startButton.waitFor({ state: 'visible', timeout: 30_000 });
      await expect(startButton).toBeEnabled();

      await this.window.screenshot({
        path: `test-output/01-before-start-click.png`,
        fullPage: true,
      });
      console.log('Screenshot saved: 01-before-start-click.png');

      // click the start button
      await startButton.click({ delay: 500, force: true });
      console.log('Start button clicked');

      await this.window.screenshot({
        path: `test-output/01-start-button-clicked.png`,
        fullPage: true,
      });
      console.log('Screenshot saved: 01-start-button-clicked.png');

      // Check notifications after button click
      console.log('Checking notifications after BUTTON CLICK');
      await this.captureVSCodeNotifications();

      console.log('waiting for stop button to be visible ...');
      const stopButton = analysisView.getByRole('button', { name: 'Stop' });
      await stopButton.waitFor({ state: 'visible', timeout: 600_000 }); // 10 minutes
      await expect(stopButton).toBeEnabled();

      // Screenshot after stop button is visible
      await this.window.screenshot({
        path: `test-output/02-stop-button-visible.png`,
        fullPage: true,
      });
      console.log('Screenshot saved: 02-stop-button-visible.png');

      console.log('Server started successfully via button click!');
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

  /**
   * Checks if the server is running by verifying the presence of the "Running" label
   * inside the unique ".server-status-wrapper" element.
   * @returns {Promise<boolean>} Whether the server is running or not
   */
  public async isServerRunning(): Promise<boolean> {
    await this.openAnalysisView();
    const analysisView = await this.getView(KAIViews.analysisView);
    const serverStatusWrapper = analysisView.locator('.server-status-wrapper');
    const runningLabel = serverStatusWrapper.getByText('Running', { exact: true });
    return await runningLabel.isVisible({ timeout: 5000 }).catch(() => false);
  }

  public async runAnalysis() {
    await this.window.waitForTimeout(15_000); // wait for 15 seconds to avoid race conditions

    console.log('Starting analysis process');

    await this.openAnalysisView();
    const analysisView = await this.getView(KAIViews.analysisView);

    try {
      // Ensure server is running before attempting analysis
      const serverRunning = await this.isServerRunning();
      if (!serverRunning) {
        throw new Error('Cannot run analysis: server is not running.');
      }

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

  public async waitForAnalysisCompleted(): Promise<void> {
    const notificationLocator = this.window.locator('.notification-list-item-message span', {
      hasText: 'Analysis completed successfully!',
    });
    await expect(notificationLocator).toBeVisible({ timeout: 10 * 60 * 1000 }); // up to 10 minutes
  }

  /**
   * Sets the list kind (issues or files) and sort order (ascending or descending) in the analysis view.
   * @param kind - The kind of list to display ('issues' or 'files').
   * @param order - The sort order ('ascending' or 'descending').
   */
  public async setListKindAndSort(kind: ListKind, order: SortOrder): Promise<void> {
    const analysisView = await this.getView(KAIViews.analysisView);
    const groupByDropdownFilter = analysisView.locator('#group-by-filter-dropdown');
    const kindButton = analysisView.locator(
      `#group-by-${kind === 'issues' ? 'violation' : 'file'}-filter`
    );

    await expect(groupByDropdownFilter).toBeVisible({ timeout: 5_000 });
    await expect(groupByDropdownFilter).toBeEnabled({ timeout: 3_000 });
    await groupByDropdownFilter.click();
    await expect(kindButton).toBeVisible({ timeout: 5_000 });
    await expect(kindButton).toBeEnabled({ timeout: 3_000 });
    await kindButton.click();
    await groupByDropdownFilter.click();
    await expect(kindButton).toHaveAttribute('aria-selected', 'true');

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

  public async getView(view: (typeof KAIViews)[keyof typeof KAIViews]): Promise<FrameLocator> {
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
    console.log('Starting GenAI configuration');
    await this.executeQuickCommand(
      `${VSCode.COMMAND_CATEGORY}: Open the GenAI model provider configuration file`
    );
    const fileTab = this.window.locator('div[data-resource-name="provider-settings.yaml"]');
    await expect(fileTab).toBeVisible();
    expect(await fileTab.getAttribute('aria-selected')).toBe('true');
    const modifier = getOSInfo() === 'macOS' ? 'Meta' : 'Control';
    await this.window.keyboard.press(`${modifier}+a+Delete`);
    await this.pasteContent(config);
    await this.window.keyboard.press(`${modifier}+s`, { delay: 500 });
    console.log('GenAI configured');
    await this.waitDefault();
  }

  public async findDebugArchiveCommand(): Promise<string> {
    return `${VSCode.COMMAND_CATEGORY}: Generate Debug Archive`;
  }

  public async createProfile(
    sources: string[],
    targets: string[],
    profileName?: string,
    customRulesPath?: string
  ) {
    await this.executeQuickCommand(`${VSCode.COMMAND_CATEGORY}: Manage Analysis Profile`);

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

    if (customRulesPath) {
      await this.selectCustomRules(customRulesPath);
    }
    return nameToUse;
  }

  public async deleteProfile(profileName: string) {
    try {
      console.log(`Attempting to delete profile: ${profileName}`);
      await this.executeQuickCommand(`${VSCode.COMMAND_CATEGORY}: Manage Analysis Profile`);
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
      await targetProfile.click({ timeout: 60000 });

      const deleteButton = manageProfileView.getByRole('button', { name: 'Delete Profile' });
      await deleteButton.waitFor({ state: 'visible', timeout: 10000 });
      // Ensures the button is clicked even if there are notifications overlaying it due to screen size
      await deleteButton.first().dispatchEvent('click');

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

  public async searchViolationAndAcceptAllSolutions(violation: string) {
    await this.searchAndRequestFix(violation, FixTypes.Issue);
    await this.acceptAllSolutions();
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
    const loadingIndicator = resolutionView.locator('.loading-indicator');

    await this.waitDefault();
    // Avoid fixing issues forever
    const MAX_FIXES = 500;

    for (let i = 0; i < MAX_FIXES; i++) {
      await expect(fixLocator.first()).toBeVisible({ timeout: 300_000 });
      // Ensures the button is clicked even if there are notifications overlaying it due to screen size
      await fixLocator.first().dispatchEvent('click');
      await this.waitDefault();

      if (!(await loadingIndicator.isVisible())) {
        return;
      }
    }

    throw new Error('MAX_FIXES limit reached while requesting solutions');
  }

  public async waitDefault() {
    await this.window.waitForTimeout(process.env.CI ? 5000 : 3000);
  }

  public async openConfiguration() {
    const analysisView = await this.getView(KAIViews.analysisView);
    await analysisView.locator('button[aria-label="Configuration"]').first().click();
  }

  public async closeConfiguration(): Promise<void> {
    const analysisView = await this.getView(KAIViews.analysisView);
    const closeButton = analysisView.locator('button[aria-label="Close drawer panel"]');
    await expect(closeButton).toBeVisible({ timeout: 5000 });
    await closeButton.click();
    await expect(closeButton).not.toBeVisible({ timeout: 5000 });
  }

  public async waitForGenAIConfigurationCompleted(): Promise<void> {
    await this.openAnalysisView();
    const analysisView = await this.getView(KAIViews.analysisView);
    await this.openConfiguration();
    const genaiCard = analysisView.locator('.pf-v6-c-card__header:has-text("Configure GenAI")');
    const completedLabel = genaiCard.getByText('Completed', { exact: true });
    await expect(completedLabel).toBeVisible({ timeout: 30000 });
    await this.closeConfiguration();
  }

  /**
   * Writes or updates the VSCode settings.json file to current workspace @ .vscode/settings.json
   * @param settings - Key - value: A pair of settings to write or update, if a setting already exists, the new values will be merged
   */
  public async openWorkspaceSettingsAndWrite(settings: Record<string, any>): Promise<void> {
    await this.executeQuickCommand('Preferences: Open Workspace Settings (JSON)');

    const modifier = getOSInfo() === 'macOS' ? 'Meta' : 'Control';
    const editor = this.window.locator('.monaco-editor .view-lines').first();
    await expect(editor).toBeVisible({ timeout: 10000 });
    await editor.click();
    await this.window.waitForTimeout(200);

    let editorContent = '';
    try {
      editorContent = await editor.innerText();
    } catch {
      editorContent = '{}';
    }

    let existingSettings: Record<string, any> = {};
    try {
      existingSettings = editorContent ? JSON.parse(editorContent.replace(/\u00A0/g, ' ')) : {};
    } catch {
      existingSettings = {};
    }

    const newContent = JSON.stringify(
      {
        ...existingSettings,
        ...settings,
      },
      null,
      2
    );

    await editor.click();
    await this.window.keyboard.press(`${modifier}+a`);
    await this.window.waitForTimeout(100);
    await this.window.keyboard.press('Backspace');
    await this.window.waitForTimeout(100);
    await this.pasteContent(newContent);

    await this.window.keyboard.press(`${modifier}+s`, { delay: 500 });
    await this.window.waitForTimeout(300);
    await this.window.keyboard.press(`${modifier}+w`);
  }

  /**
   * Opens the Konveyor command to configure Solution Server credentials,
   * then types username and password into the respective input fields.
   * All commands are executed from the project folder
   * @param username - Username for solution server
   * @param password - Password for solution server
   */
  public async configureSolutionServerCredentials(
    username: string,
    password: string
  ): Promise<void> {
    await this.executeQuickCommand(
      `${VSCode.COMMAND_CATEGORY}: Configure Solution Server Credentials`
    );

    const usernameInput = this.window.getByRole('textbox', { name: 'input' });
    await expect(usernameInput).toBeVisible({ timeout: 5000 });
    await usernameInput.fill(username);
    await usernameInput.press('Enter');

    const passwordInput = this.window.getByRole('textbox', { name: 'input' });
    await expect(passwordInput).toBeVisible({ timeout: 5000 });
    await passwordInput.fill(password);
    await passwordInput.press('Enter');
  }

  public async executeTerminalCommand(command: string, expectedOutput?: string): Promise<void> {
    if (!this.repoDir || !this.branch) {
      throw new Error('executeTerminalCommand requires repoDir and branch to be set');
    }
    if (!(await this.window.getByRole('tab', { name: 'Terminal' }).isVisible())) {
      await this.executeQuickCommand(`View: Toggle Terminal`);
    }

    await expect(this.window.locator('.terminal-widget-container')).toBeVisible();
    await this.window.keyboard.type(`cd /projects/${this.repoDir}`);
    await this.window.keyboard.press('Enter');
    await expect(this.window.getByText(`${this.repoDir} (${this.branch})`).last()).toBeVisible();
    await this.window.keyboard.type(command);
    await this.window.keyboard.press('Enter');
    if (expectedOutput) {
      await expect(this.window.getByText(expectedOutput).first()).toBeVisible();
    }

    await this.executeQuickCommand(`View: Toggle Terminal`);
    await expect(this.window.locator('.terminal-widget-container')).not.toBeVisible();
  }

  public async getIssuesCount(): Promise<number> {
    const analysisView = await this.getView(KAIViews.analysisView);
    const issuesCount = analysisView.locator('.violations-count h4.violations-title');
    const issuesText = await issuesCount.textContent();
    const issuesMatch = issuesText?.match(/Total Issues:\s*(\d+)/i);
    return Number(issuesMatch?.[1]);
  }

  public async getIncidentsCount(): Promise<number> {
    const analysisView = await this.getView(KAIViews.analysisView);
    const incidentsCount = analysisView.locator('.violations-count small.violations-subtitle');
    const incidentsText = await incidentsCount.textContent();
    const incidentsMatch = incidentsText?.match(/\(([\d,]+)\s+incidents?\s+found\)/i);
    return Number(incidentsMatch?.[1].replace(/,/g, ''));
  }

  private async getProfileContainerByName(profileName: string, profileView: FrameLocator) {
    const profileList = profileView.getByRole('list', {
      name: 'Profile list',
    });
    await profileList.waitFor({ state: 'visible', timeout: 30000 });

    const targetProfile = profileList.locator(
      `//li[.//span[normalize-space() = "${profileName}" or normalize-space() = "${profileName} (active)"]]`
    );
    await expect(targetProfile).toHaveCount(1, { timeout: 60000 });
    return targetProfile;
  }

  public async clickOnProfileContainer(profileName: string, profileView: FrameLocator) {
    const targetProfile = await this.getProfileContainerByName(profileName, profileView);
    await targetProfile.click({ timeout: 60000 });
  }

  public async activateProfile(profileName: string, profileView?: FrameLocator) {
    const pageView = profileView ? profileView : await this.getView(KAIViews.manageProfiles);
    await this.clickOnProfileContainer(profileName, pageView);
    const activationButton = pageView.getByRole('button', { name: 'Make Active' });
    await activationButton.waitFor({ state: 'visible', timeout: 10000 });
    await activationButton.click();
    const activeProfileButton = pageView.getByRole('button', { name: 'Active Profile' });
    await expect(activeProfileButton).toBeVisible({ timeout: 30000 });
    await expect(activeProfileButton).toBeDisabled({ timeout: 30000 });
  }

  public async doProfileMenuButtonAction(
    profileName: string,
    actionName: ProfileActions,
    profileView?: FrameLocator
  ) {
    let manageProfileView = profileView ? profileView : await this.getView(KAIViews.manageProfiles);
    const targetProfile = await this.getProfileContainerByName(profileName, manageProfileView);
    const kebabMenuButton = targetProfile.getByLabel('Profile actions menu');
    await kebabMenuButton.click();
    await manageProfileView.getByRole('menuitem', { name: actionName }).click();
    await this.waitDefault();
    if (actionName === ProfileActions.deleteProfile) {
      const confirmButton = manageProfileView
        .getByRole('dialog', { name: 'Delete profile?' })
        .getByRole('button', { name: 'Confirm' });
      await confirmButton.click();
    }
  }

  public async removeProfileCustomRules(profileName: string, pageView?: FrameLocator) {
    const profileView = pageView ? pageView : await this.getView(KAIViews.manageProfiles);
    await this.clickOnProfileContainer(profileName, profileView);
    const customRuleList = profileView.getByRole('list', { name: 'Custom Rules' });
    const removeButtons = customRuleList.getByRole('button', { name: 'Remove rule' });
    const rulesInList = await removeButtons.count();
    for (let i = 0; i < rulesInList; i++) {
      await removeButtons.first().click();
    }
    await expect(removeButtons).toHaveCount(0);
  }

  public async getCurrActiveProfile() {
    const view = await this.getView(KAIViews.manageProfiles);
    const activeProfileLocator = view.locator('span:has(em:text-is("(active)"))');
    const fullText = await activeProfileLocator.textContent();
    if (fullText == null) {
      throw new Error('No active profile found');
    }
    const profileName = fullText.replace('(active)', '').trim();
    return profileName;
  }

  private async captureVSCodeNotifications(): Promise<void> {
    try {
      console.log('=== Capturing VSCode Notifications ===');

      // Open notification center by clicking the bell icon
      console.log('Opening notification center...');
      const bellIcon = this.window.locator('.codicon-bell, [aria-label*="Notification"]').first();
      if (await bellIcon.isVisible({ timeout: 2000 }).catch(() => false)) {
        await bellIcon.click();
        await this.window.waitForTimeout(1000);
      }

      // Check if notification center is visible
      const notificationCenter = await this.window
        .locator('.notifications-list-container')
        .isVisible()
        .catch(() => false);

      if (notificationCenter) {
        console.log('Notification center is open');

        // Get all notification rows
        const notificationRows = await this.window
          .locator('.notifications-list-container .monaco-list-row')
          .all();
        console.log(`Found ${notificationRows.length} notification(s)\n`);

        if (notificationRows.length === 0) {
          console.log('No notifications found');
          return;
        }

        // Print each notification's full content
        for (let i = 0; i < notificationRows.length; i++) {
          const fullText = await notificationRows[i].textContent();
          console.log(`--- Notification ${i + 1} ---`);
          console.log(fullText);
          console.log('');
        }
      } else {
        console.log('Notification center not visible');
      }

      // Also check for toast notifications
      const toasts = await this.window
        .locator('.notifications-toasts .notification-toast-container')
        .all();
      if (toasts.length > 0) {
        console.log(`\nFound ${toasts.length} toast notification(s):`);
        for (let i = 0; i < toasts.length; i++) {
          const toastText = await toasts[i].textContent();
          console.log(`Toast ${i + 1}: ${toastText}`);
        }
      }

      console.log('=== End Notifications ===\n');
    } catch (error) {
      console.error('Failed to capture notifications:', error as Error);
    }
  }
}
