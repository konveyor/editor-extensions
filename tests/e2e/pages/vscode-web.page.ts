import * as fs from 'fs';
import { BrowserContextOptions } from 'playwright';
import { expect, Page } from '@playwright/test';
import { VSCode } from './vscode.page';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { BrowserContext } from 'playwright-core';
import { getOSInfo } from '../utilities/utils';
import { KAIViews } from '../enums/views.enum';
import { genAISettingKey, kaiCacheDir, kaiDemoMode } from '../enums/configuration-options.enum';
import pathlib from 'path';

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
      throw new Error('User is not logged in.');
    }

    await page.goto(`${process.env.WEB_BASE_URL}/dashboard/#/workspaces/`);
    await page.getByRole('heading', { name: 'Workspaces', exact: true }).waitFor();

    let newPage;
    const repoRow = page.locator('tbody tr', { hasText: repoDir });

    // Creates a new workspace or reuses one that already exists for the same repository
    if (!(await repoRow.isVisible())) {
      newPage = await VSCodeWeb.createWorkspace(context, page, repoUrl, branch);
    } else {
      [newPage] = await Promise.all([
        context.waitForEvent('page'),
        repoRow.getByRole('button', { name: 'Open' }).first().click(),
      ]);
    }

    const vscode = new VSCodeWeb(newPage, repoDir, branch);
    await newPage.waitForLoadState();
    await page.close();
    await newPage
      .getByRole('button', { name: 'Yes, I trust the authors' })
      .click({ timeout: 300_000 });
    await expect(
      newPage.locator('h2').filter({ hasText: 'Get Started with VS Code for' })
    ).toBeVisible();

    await expect(newPage.getByText('Waiting metrics...')).toBeVisible({ timeout: 300_000 });
    await expect(newPage.getByText('Waiting metrics...')).not.toBeVisible({ timeout: 300_000 });

    await newPage.waitForTimeout(30_000);
    await vscode.executeQuickCommand('Workspaces: Manage Workspace Trust');
    const trustBtn = newPage.getByRole('button', { name: 'Trust', exact: true }).first();
    if (await trustBtn.isVisible()) {
      await trustBtn.click();
    }
    await vscode.openWorkspaceSettingsAndWrite({
      [kaiCacheDir]: pathlib.join('.vscode', 'cache'),
      [kaiDemoMode]: true,
      'java.configuration.updateBuildConfiguration': 'automatic',
    });
    await vscode.openWorkspaceSettingsAndWrite({ [genAISettingKey]: true });
    // Resets the workspace so it can be reused
    await vscode.executeTerminalCommand(
      `git restore --staged . && git checkout . && git clean -df && git checkout ${vscode.branch}`
    );
    await vscode.ensureLLMCache(false);

    const navLi = newPage.locator(`a[aria-label^="${VSCode.COMMAND_CATEGORY}"]`).locator('..');
    if (!(await navLi.isVisible())) {
      await vscode.installExtension();
    }

    await expect(newPage.getByRole('button', { name: 'Java:' })).toBeVisible({ timeout: 80_000 });
    const javaLightSelector = newPage.getByRole('button', { name: 'Java: Lightweight Mode' });
    if (await javaLightSelector.isVisible()) {
      await javaLightSelector.click();
    }

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
      !process.env.WEB_BASE_URL ||
      !process.env.WEB_LOGIN ||
      !process.env.WEB_PASSWORD ||
      !process.env.CORE_VSIX_DOWNLOAD_URL
    ) {
      throw new Error(
        'The following environment variables are required for running tests in web mode: WEB_BASE_URL, WEB_LOGIN, WEB PASSWORD, CORE_VSIX_DOWNLOAD_URL'
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
    await page.locator('#inputUsername').fill(process.env.WEB_LOGIN);
    await page.locator('#inputPassword').fill(process.env.WEB_PASSWORD);
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
    await page.locator('#git-repo-url').fill(repoUrl);
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

  private async installExtension(): Promise<void> {
    // https://github.com/microsoft/playwright/issues/8850#issuecomment-3250011388
    // TODO (abrugaro) explore ways for installing the extension from a local file
    await this.executeTerminalCommand(
      `clear && wget ${process.env.VSIX_DOWNLOAD_URL} -O ../extension.vsix`,
      '‘../extension.vsix’ saved'
    );
    await this.executeQuickCommand(`Extensions: Install from VSIX...`);
    const pathInput = this.window.locator('.quick-input-box input');
    await expect(pathInput).toHaveValue('/home/user/');
    await pathInput.fill('/projects/extension.vsix');
    await expect(
      this.window.locator('.quick-input-list-entry').filter({ hasText: 'extension.vsix' })
    ).toBeVisible();
    await this.window.getByRole('button', { name: 'Install' }).click();
    await this.executeQuickCommand(`View: Toggle Terminal`);
    await expect(
      this.window.getByText('Completed installing extension.', { exact: true })
    ).toBeVisible({ timeout: 300_000 });
    await expect(
      this.window.locator(`a[aria-label^="${VSCode.COMMAND_CATEGORY}"]`).locator('..')
    ).toBeVisible({ timeout: 300_000 });
  }

  private async uploadFile(filePath: string) {
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
    const fileItem = this.window.locator(`.explorer-folders-view .monaco-list-row`, {
      hasText: fileName,
    });
    await expect(fileItem).toBeVisible({ timeout: 60_000 });
  }
}
