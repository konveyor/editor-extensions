import { Page } from '@playwright/test';
import { VSCode } from './vscode.page';
import { getOSInfo } from '../utilities/utils';

export class FileEditorPage {
  private readonly window: Page;

  public constructor(private readonly vsCode: VSCode) {
    this.window = vsCode.getWindow();
  }

  public async readFile(filename: string): Promise<string> {
    await this.ensureFileIsActiveTab(filename);
    const content = await this.window.locator('.monaco-editor textarea').inputValue();
    return content;
  }

  async saveFile(filename: string): Promise<void> {
    await this.ensureFileIsActiveTab(filename);
    const modifier = getOSInfo() === 'macOS' ? 'Meta' : 'Control';
    const tabSelector = this.window.locator(`.tab[role="tab"][data-resource-name="${filename}"]`);
    await tabSelector.waitFor({ state: 'visible', timeout: 10000 });
    await tabSelector.getByText(filename).click();
    await this.window.keyboard.press(`${modifier}+S`, { delay: 500 });
  }

  public async getCurrentActiveTab(): Promise<{ name: string } | undefined> {
    const activeTab = await this.window.locator('.tab.active .label-name').textContent();
    if (activeTab) {
      return { name: activeTab };
    }
    return undefined;
  }

  private async ensureFileIsActiveTab(filename: string): Promise<void> {
    const currentActiveTab = await this.getCurrentActiveTab();
    if (currentActiveTab?.name !== filename) {
      throw new Error(
        `File ${filename} is not the current active tab, current active tab is ${currentActiveTab?.name}`
      );
    }
  }
}
