import { expect, Page } from '@playwright/test';
import { VSCode } from '../pages/vscode.page';
import { getOSInfo } from './utils';

export class FileEditorPage {
  private readonly window: Page;

  public constructor(private readonly vsCode: VSCode) {
    this.window = vsCode.getWindow();
  }

  async readFile(filename: string): Promise<string> {
    await this.openFile(filename);
    const content = await this.window.locator('.monaco-editor textarea').inputValue();
    return content;
  }

  async saveFile(filename: string): Promise<void> {
    const modifier = getOSInfo() === 'macOS' ? 'Meta' : 'Control';
    const tabSelector = this.window.locator(`.tab[role="tab"][data-resource-name="${filename}"]`);
    await tabSelector.waitFor({ state: 'visible', timeout: 10000 });
    await tabSelector.getByText(filename).click();
    await this.window.keyboard.press(`${modifier}+S`, { delay: 500 });
  }

  async openFile(filename: string, closeOtherEditors: boolean = false): Promise<void> {
    const modifier = getOSInfo() === 'macOS' ? 'Meta' : 'Control';
    await this.window.keyboard.press(`${modifier}+P`, { delay: 500 });
    const input = this.window.getByPlaceholder(
      'Search files by name (append : to go to line or @ to go to symbol)'
    );
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill(filename);
    const fileLocator = await this.window.locator('a').filter({ hasText: filename }).first();
    await expect(fileLocator).toBeVisible({ timeout: 10000 });
    await fileLocator.click();
    if (closeOtherEditors) {
      await this.vsCode.executeQuickCommand('View: Close Other Editors in Group');
    }
    const tabSelector = `.tab[role="tab"][data-resource-name="${filename}"]`;
    await expect(this.window.locator(tabSelector)).toBeVisible({ timeout: 10000 });
  }

  async getCurrentFile(): Promise<{ path: string } | undefined> {
    const activeTab = await this.window.locator('.tab.active .label-name').textContent();
    if (activeTab) {
      return { path: activeTab };
    }
    return undefined;
  }
}
