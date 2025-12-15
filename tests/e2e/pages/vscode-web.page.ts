import * as fs from 'fs';
import { BrowserContextOptions, chromium } from 'playwright';
import { expect, Page } from '@playwright/test';
import { VSCode } from './vscode.page';
import { existsSync } from 'node:fs';
import { BrowserContext } from 'playwright-core';
import { generateRandomString, getOSInfo } from '../utilities/utils';
import { KAIViews } from '../enums/views.enum';
import { ExtensionTypes } from '../enums/extension-types.enum';
import pathlib from 'path';
import { SCREENSHOTS_FOLDER } from '../utilities/consts';

export class VSCodeWeb extends VSCode {
  protected window: Page;

  constructor(window: Page, repoDir?: string, branch = 'main') {
    super();
    this.window = window;
    this.repoDir = repoDir;
    this.branch = branch;
  }

  public static async open(repoUrl?: string, repoDir?: string, branch = 'main') {
    const browser = await chromium.launch();
    if (!existsSync('./web-state.json')) {
      return VSCodeWeb.init(repoUrl, repoDir, branch);
    }

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      storageState: './web-state.json',
    });

    const page = await context.newPage();

    const loginButton = page.getByRole('button', { name: 'Log in' }).first();
    if (await loginButton.isVisible()) {
      throw new Error('VSCodeWeb.open: User is not logged in.');
    }

    await page.goto(`${process.env.WEB_BASE_URL}/dashboard/#/workspaces/`);
    await page.getByRole('heading', { name: 'Workspaces', exact: true }).waitFor();

    let newPage;
    const repoRow = page.locator('tbody tr', { hasText: repoDir });

    // Creates a new workspace or reuses one that already exists for the same repository
    if (!(await repoRow.isVisible())) {
      console.log('VSCodeWeb.open: Creating new workspace...');
      newPage = await VSCodeWeb.createWorkspace(context, page, repoUrl, branch);
    } else {
      console.log('VSCodeWeb.open: Found existing workspace');
      console.log(await repoRow.allTextContents());

      [newPage] = await Promise.all([
        context.waitForEvent('page'),
        repoRow.getByRole('button', { name: 'Open' }).first().click(),
      ]);
    }

    const vscode = new VSCodeWeb(newPage, repoDir, branch);
    await newPage.waitForLoadState();
    await page.close();

    try {
      await newPage
        .getByRole('button', { name: 'Yes, I trust the authors' })
        .click({ timeout: 300_000 });
    } catch (error) {
      console.log('VSCodeWeb.open: Trust button not found, trying to continue', error);
    }

    await expect(
      newPage.locator('h2').filter({ hasText: 'Get Started with VS Code for' })
    ).toBeVisible();

    await expect(newPage.getByText('Waiting metrics...')).toBeVisible({ timeout: 300_000 });
    await expect(newPage.getByText('Waiting metrics...')).not.toBeVisible({ timeout: 300_000 });
    console.log('VSCodeWeb.open: Metrics loaded');

    // TODO: Replace this waiting
    await newPage.waitForTimeout(30_000);
    await vscode.executeQuickCommand('Workspaces: Manage Workspace Trust');
    const trustBtn = newPage.getByRole('button', { name: 'Trust', exact: true }).first();
    await expect(
      vscode.getWindow().locator('.workspace-trust-limitations-title-text').first()
    ).toBeVisible();
    if (await trustBtn.isVisible()) {
      console.log('VSCodeWeb.open: Workspace trusted');
      await trustBtn.click();
    } else {
      console.log('VSCodeWeb.open: Workspace was ALREADY trusted');
    }
    // TODO: After trusting the workspace the extensions are activated, need a way to handle it instead of just waiting
    await newPage.waitForTimeout(30_000);
    // Resets the workspace so it can be reused
    await vscode.executeTerminalCommand(
      `git restore --staged . && git checkout . && git clean -df && git checkout ${vscode.branch}`
    );

    const navLi = newPage.locator(`a[aria-label^="${VSCode.COMMAND_CATEGORY}"]`).locator('..');
    if (!(await navLi.isVisible())) {
      await vscode.installExtensions([ExtensionTypes.Core, ExtensionTypes.Java]);
    }

    await expect(newPage.getByRole('button', { name: 'Java:' })).toBeVisible({ timeout: 80_000 });
    const javaLightSelector = newPage.getByRole('button', { name: 'Java: Lightweight Mode' });
    if (await javaLightSelector.isVisible()) {
      console.log('VSCodeWeb.open: Change Java extension mode');
      await javaLightSelector.click();
    } else {
      console.log('VSCodeWeb.open: Java extension is NOT in lightweight mode');
      console.log(await newPage.getByRole('button', { name: 'Java:' }).allTextContents());
    }
    await newPage.screenshot({
      path: pathlib.join(SCREENSHOTS_FOLDER, `java-button.png`),
    });

    const javaReadySelector = newPage.getByRole('button', { name: 'Java: Ready' });
    await javaReadySelector.waitFor({ timeout: 180_000 });
    return vscode;
  }

  /**
   * launches VSCode with KAI plugin installed and repoUrl app opened.
   * @param repoUrl
   * @param repoDir path to repo
   * @param branch optional branch to clone from
   */
  public static async init(repoUrl?: string, repoDir?: string, branch?: string): Promise<VSCode> {
    if (
      [
        process.env.WEB_BASE_URL,
        process.env.WEB_LOGIN,
        process.env.WEB_PASSWORD,
        process.env.CORE_VSIX_DOWNLOAD_URL,
        process.env.JAVA_VSIX_DOWNLOAD_URL,
      ].some((envVar) => !envVar)
    ) {
      throw new Error(
        'The following environment variables are required for running tests in web mode: WEB_BASE_URL, WEB_LOGIN, WEB PASSWORD, CORE_VSIX_DOWNLOAD_URL, JAVA_VSIX_DOWNLOAD_URL'
      );
    }
    const browser = await chromium.launch();
    const contextOptions: BrowserContextOptions = { ignoreHTTPSErrors: true };
    if (existsSync('./web-state.json')) {
      contextOptions.storageState = './web-state.json';
    }
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await page.goto(`${process.env.WEB_BASE_URL}/dashboard/#/workspaces/`);
    const loginButton = page.getByRole('button', { name: 'Log in' }).first();
    if (!(await loginButton.isVisible())) {
      await page.close();
      return VSCodeWeb.open(repoUrl, repoDir, branch);
    }
    await expect(loginButton).toBeVisible();
    await loginButton.click();
    const kubeadminBtn = page.getByRole('link', { name: 'kube:admin' }).first();
    await expect(kubeadminBtn).toBeVisible();
    await kubeadminBtn.click();
    await page.locator('#inputUsername').fill(process.env.WEB_LOGIN!);
    await page.locator('#inputPassword').fill(process.env.WEB_PASSWORD!);
    await page.getByRole('button', { name: 'Log in' }).click();

    const allowSelectButton = page.getByRole('button', { name: 'Allow' });
    if (await allowSelectButton.isVisible()) {
      await allowSelectButton.click();
    }
    await context.storageState({ path: './web-state.json' });
    await page.waitForTimeout(5000);
    await page.close();
    return VSCodeWeb.open(repoUrl, repoDir, branch);
  }

  public async closeVSCode(): Promise<void> {
    try {
      if (!this.window) {
        return;
      }
      const ctx = this.window.context();
      if (!this.window.isClosed()) {
        await this.window.close({ runBeforeUnload: true });
      }

      await ctx.close();
      const browser = ctx.browser();
      if (browser) {
        await browser.close();
      }
    } catch (e) {
      console.warn('VSCodeWeb.closeVSCode: ignoring error during close', e);
    }
  }

  protected async selectCustomRules(customRulesPath: string) {
    const manageProfileView = await this.getView(KAIViews.manageProfiles);
    console.log(`Selecting custom rules from: ${customRulesPath}`);

    const customRulesButton = manageProfileView.getByRole('button', {
      name: 'Select Custom Rules…',
    });
    await customRulesButton.click();
    const pathInput = this.window.locator('.quick-input-box input');
    await expect(pathInput).toHaveValue(`/projects/${this.repoDir}/`);
    await pathInput.fill(`/projects/${this.repoDir}/${customRulesPath}/`);
    await expect(
      this.window.locator('.quick-input-list-entry').filter({ hasText: '.yaml' }).first()
    ).toBeVisible();
    await this.window
      .locator('.quick-input-action')
      .getByRole('button', { name: 'Select Custom Rules' })
      .click();

    const customRulesLabel = manageProfileView
      .locator('[class*="label"], [class*="Label"]')
      .filter({ hasText: customRulesPath });
    await expect(customRulesLabel.first()).toBeVisible({ timeout: 30000 });
  }

  /**
   * Unzips all test data into workspace .vscode/ directory, deletes the zip files if cleanup is true
   * @param cleanup
   */
  public async ensureLLMCache(cleanup: boolean = false): Promise<void> {
    const wspacePath = this.llmCachePaths().workspacePath;
    const storedPath = this.llmCachePaths().storedPath;
    await this.executeTerminalCommand(`rm -rf ../${wspacePath}`);
    if (cleanup) {
      return;
    }

    await this.executeTerminalCommand(`mkdir -p ../${wspacePath}`);
    if (!fs.existsSync(storedPath)) {
      console.info('No local cache file found');
      return;
    }

    await this.uploadFile(storedPath);
    const zipName = storedPath.replace(/\\/g, '/').split('/').pop();
    await this.executeTerminalCommand(`unzip -o ./${zipName} -d ../${wspacePath}`);
  }

  public async updateLLMCache() {
    console.info('No need to update LLM cache in web mode, skipping...');
  }

  public async pasteContent(content: string) {
    await this.window.evaluate((content) => navigator.clipboard.writeText(content), content);
    const modifier = getOSInfo() === 'macOS' ? 'Meta' : 'Control';
    await this.window.keyboard.press(`${modifier}+v`, { delay: 500 });
  }

  public getWindow(): Page {
    if (!this.window) {
      throw new Error('VSCode window is not initialized.');
    }
    return this.window;
  }

  private static async createWorkspace(
    ctx: BrowserContext,
    page: Page,
    repoUrl?: string,
    branch = 'main'
  ): Promise<Page> {
    if (!repoUrl) {
      throw new Error('Repo URL is missing for creating a new workspace');
    }
    await page.getByRole('link', { name: 'Create Workspace' }).click();
    await page.locator('#git-repo-url').fill(`${repoUrl}?cpuLimit=4&memoryLimit=7Gi`);
    await page.locator('#accordion-item-git-repo-options').click();
    await page.getByPlaceholder('Enter the branch of the Git Repository').fill(branch);
    const newPagePromise = ctx.waitForEvent('page');
    await page.locator('#create-and-open-button').click();
    const continueBtn = page.getByRole('button', { name: 'Continue' });
    if (await continueBtn.isVisible()) {
      // Asking for source trust the first time a new remote repository domain is used
      await continueBtn.click();
    }

    return await newPagePromise;
  }

  /**
   * Downloads a file by URL into the workspace
   * @param url
   * @private
   */
  private async getFileByUrl(url: string): Promise<string> {
    // https://github.com/microsoft/playwright/issues/8850#issuecomment-3250011388
    // TODO (abrugaro) Install the extension from a local file (upload and install)
    const extensionFileName = `${generateRandomString()}.vsix`;
    await this.executeTerminalCommand(
      `clear && wget ${url} -O ${extensionFileName}`,
      `‘${extensionFileName}’ saved`
    );
    return extensionFileName;
  }

  private async installExtensions(extensions: ExtensionTypes[]) {
    for (const extension of extensions) {
      console.log('Installing extension', extension);
      const vsixPath = process.env[`${extension}_VSIX_FILE_PATH`];
      const vsixUrl = process.env[`${extension}_VSIX_DOWNLOAD_URL`];
      let extensionFileName = '';
      if (vsixPath) {
        if (!fs.existsSync(vsixPath)) {
          throw new Error(`${extension}_VSIX_FILE_PATH is set but the path is not correct`);
        }
        extensionFileName = await this.uploadFile(vsixPath);
      } else if (vsixUrl) {
        extensionFileName = await this.getFileByUrl(vsixUrl!);
      } else {
        throw new Error(
          `${extension}_VSIX_FILE_PATH nor ${extension}_VSIX_DOWNLOAD_URL are defined`
        );
      }

      await this.executeQuickCommand(`Extensions: Install from VSIX...`);
      const pathInput = this.window.locator('.quick-input-box input');
      await expect(pathInput).toHaveValue('/home/user/', { timeout: 30_000 });
      await pathInput.fill(`/projects/${this.repoDir}/${extensionFileName}`);
      await expect(
        this.window.locator('.quick-input-list-entry').filter({ hasText: extensionFileName })
      ).toBeVisible({ timeout: 30_000 });
      await this.window.getByRole('button', { name: 'Install' }).click();
      await expect(
        this.window.getByText('Completed installing extension.', { exact: true })
      ).toBeVisible({ timeout: 300_000 });
      await expect(
        this.window.locator(`a[aria-label^="${VSCode.COMMAND_CATEGORY}"]`).locator('..')
      ).toBeVisible({ timeout: 300_000 });
      console.log(`${extension} extension installed`);
      await this.waitDefault();
    }
  }

  public async uploadFile(filePath: string): Promise<string> {
    await this.openLeftBarElement('Explorer');

    await this.window.locator('.explorer-folders-view').click({ button: 'right' });

    const fileChooserPromise = this.window.waitForEvent('filechooser').catch(() => null);

    const uploadAnchor = this.window.locator(`div.context-view .monaco-menu a.action-menu-item`, {
      hasText: 'Upload...',
    });
    await expect(uploadAnchor).toBeVisible();
    await this.waitDefault();
    await Promise.all([fileChooserPromise, uploadAnchor.first().click({ timeout: 1500 })]);
    const fileChooser = await fileChooserPromise;
    if (fileChooser) {
      await fileChooser.setFiles([filePath]);
    }

    const fileName = filePath.replace(/\\/g, '/').split('/').pop();
    if (!fileName) {
      throw new Error(`Could not find file name from ${filePath}`);
    }
    const fileItem = this.window.locator(`.explorer-folders-view .monaco-list-row`, {
      hasText: fileName,
    });
    const uploadingLinks = this.window.locator('a.statusbar-item-label:has-text("Uploading")');
    await expect(uploadingLinks).toHaveCount(0, { timeout: 120_000 });
    await expect(fileItem, 'File took too long to upload').toBeVisible({
      timeout: 120_000,
    });
    // After a file is uploaded, the corresponding new tab opens. This tab may take longer to appear than the file item in the explorer view
    await expect(this.window.locator(`div.tab a.label-name:has-text("${fileName}")`)).toBeVisible({
      timeout: 60_000,
    });
    await this.waitDefault();
    await this.executeQuickCommand('View: Close Editor');

    return fileName;
  }

  public async ensureDebugArchive(): Promise<void> {
    await this.executeTerminalCommand(
      'ls ".vscode/debug-archive.zip" && unzip -o ".vscode/debug-archive.zip" -d ".vscode" && ls ".vscode/logs/extension.log"',
      '.vscode/logs/extension.log'
    );
  }
}
