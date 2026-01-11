import { Page } from '@playwright/test';
import { VSCode } from './vscode.page';
import { getOSInfo } from '../utilities/utils';
import { expect } from '../fixtures/test-repo-fixture';

export class TabManager {
  private readonly window: Page;

  public constructor(private readonly vsCode: VSCode) {
    this.window = vsCode.getWindow();
  }

  /**
   * Reads the content of the active tab.
   * Throws an error if the file is not the current active tab.
   * @param tabName The name of the file to read.
   * @returns The content of the file.
   */
  public async readTabFile(tabName: string): Promise<string> {
    await this.ensureTabIsActive(tabName);
    const content = await this.window.locator('.monaco-editor textarea').inputValue();
    return content;
  }

  /**
   * Saves the content of the active tab.
   * Throws an error if the file is not the current active tab.
   * @param tabName The name of the file to save.
   */
  public async saveTabFile(tabName: string): Promise<void> {
    await this.ensureTabIsActive(tabName);
    const modifier = getOSInfo() === 'macOS' ? 'Meta' : 'Control';
    await this.window.keyboard.press(`${modifier}+S`, { delay: 500 });
  }

  /**
   * Gets the name of the current active tab.
   * @returns The name of the current active tab.
   */
  public async getCurrentActiveTab(): Promise<string | undefined> {
    const activeTab = await this.window.locator('.tab.active .label-name').textContent();
    if (activeTab) {
      return activeTab;
    }
    return undefined;
  }

  /**
   * Ensures the specified file is the current active tab.
   * Throws an error if the file is not the current active tab.
   * @param tabName The name of the file to ensure is the current active tab.
   */
  public async ensureTabIsActive(tabName: string): Promise<void> {
    const currentActiveTab = await this.getCurrentActiveTab();
    if (currentActiveTab !== tabName) {
      await this.focusTabByName(tabName);
    }
  }

  /**
   * Focuses the tab with the specified tabName.
   * Throws an error if the tab is not found.
   * @param tabName The name of the file/tab to focus.
   */
  public async focusTabByName(tabName: string): Promise<void> {
    const tabSelector = `.tab[role="tab"][data-resource-name="${tabName}"]`;
    const tab = await this.window.locator(tabSelector);
    await expect(tab).toBeVisible({ timeout: 10000 });
    await tab.first().click();
  }

  /**
   * Closes the tab with the specified tabName.
   * Throws an error if the tab is not found.
   * @param tabName The name of the file/tab to close.
   */
  public async closeTabByName(tabName: string): Promise<void> {
    const tabSelector = `.tab[role="tab"][data-resource-name="${tabName}"]`;
    const tab = await this.window.locator(tabSelector);
    await expect(tab).toBeVisible({ timeout: 10000 });
    const closeBtn = tab.locator('.tab-actions .action-label.codicon-close').first();
    await expect(closeBtn).toBeVisible({ timeout: 5000 });
    await closeBtn.click();
  }
}
