import { _electron as electron, FrameLocator } from 'playwright';
import { execSync } from 'child_process';
import { downloadFile } from '../utilities/download.utils';
import {
  cleanupRepo,
  generateRandomString,
  getOSInfo,
  getVscodeExecutablePath,
} from '../utilities/utils';
import * as path from 'path';
import { LeftBarItems } from '../enums/left-bar-items.enum';
import { expect } from '@playwright/test';
import { Application } from './application.pages';
import { DEFAULT_PROVIDER } from '../fixtures/provider-configs.fixture';
import { KAIViews } from '../enums/views.enum';
import fs from 'fs';

export class VSCode extends Application {
  public static async open(repoUrl?: string, repoDir?: string) {
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

    const args = ['--disable-workspace-trust', '--skip-welcome'];
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
    const vscodeApp = await electron.launch({
      executablePath: executablePath,
      args,
    });

    const window = await vscodeApp.firstWindow({ timeout: 60000 });
    console.log('VSCode opened');
    return new VSCode(vscodeApp, window);
  }

  /**
   * launches VSCode with KAI plugin installed and repoUrl app opened.
   * @param repoDir path to repo
   */
  public static async init(repoDir?: string): Promise<VSCode> {
    try {
      await VSCode.installExtension();
      return repoDir ? VSCode.open(repoDir) : VSCode.open();
    } catch (error) {
      console.error('Error launching VSCode:', error);
      throw error;
    }
  }

  private static async installExtension(): Promise<void> {
    try {
      const installedExtensions = execSync('code --list-extensions', {
        encoding: 'utf-8',
      });

      if (installedExtensions.includes('konveyor.konveyor-ai')) {
        console.log(`Extension already installed`);
        return;
      }

      let extensionPath = '';
      if (process.env.VSIX_FILE_PATH && fs.existsSync(process.env.VSIX_FILE_PATH)) {
        console.log(`vsix present in ${process.env.VSIX_FILE_PATH}`);
        extensionPath = process.env.VSIX_FILE_PATH;
      } else if (process.env.VSIX_DOWNLOAD_URL) {
        console.log(`vsix downloaded from ${process.env.VSIX_DOWNLOAD_URL}`);
        extensionPath = 'extension.vsix';
        await downloadFile(process.env.VSIX_DOWNLOAD_URL, extensionPath);
      }

      execSync(`code --install-extension "${extensionPath}"`, {
        stdio: 'inherit',
      });
      console.log('Extension installed successfully.');
    } catch (error) {
      console.error('Error installing the VSIX extension:', error);
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

  private async executeQuickCommand(command: string) {
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
    await expect(navLi).toBeVisible();
    if ((await navLi.getAttribute('aria-expanded')) === 'false') {
      await navLi.click();
    }
  }

  public async openAnalysisView(): Promise<void> {
    await this.openLeftBarElement(LeftBarItems.Konveyor);

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
    await this.window.keyboard.press('Control+a+Delete');
    await this.pasteContent(config);
    await this.window.keyboard.press('Control+s', { delay: 500 });
  }

  public async createProfile(sources: string[], targets: string[], profileName?: string) {
    await this.executeQuickCommand('Konveyor: Manage Analysis Profile');

    const manageProfileView = await this.getView(KAIViews.manageProfiles);
    // TODO ask for/add test-id for this button and comboboxes
    await manageProfileView.getByRole('button', { name: '+ New Profile' }).click();

    const randomName = generateRandomString();
    const nameToUse = profileName ? `${profileName}-${randomName}` : randomName;
    await manageProfileView.getByRole('textbox', { name: 'Profile Name' }).fill(nameToUse);

    // Select Targets
    const targetsInput = manageProfileView
      .getByRole('combobox', { name: 'Type to filter' })
      .first();
    await targetsInput.click({ delay: 500 });

    for (const target of targets) {
      await targetsInput.fill(target);
      await manageProfileView.getByRole('option', { name: target, exact: true }).click();
    }
    await this.window.keyboard.press('Escape');

    // Select Source
    const sourceInput = manageProfileView.getByRole('combobox', { name: 'Type to filter' }).nth(1);
    await sourceInput.click({ delay: 500 });

    for (const source of sources) {
      await sourceInput.fill(source);
      await manageProfileView.getByRole('option', { name: source, exact: true }).click();
    }
    await this.window.keyboard.press('Escape');
  }
}
