import { VSCode } from './vscode.page';
import { extensionId } from '../utilities/utils';
import { VSCodeWeb } from './vscode-web.page';
import { expect } from '@playwright/test';
import { SCREENSHOTS_FOLDER } from '../utilities/consts';

export class Configuration {
  public constructor(private readonly vsCode: VSCode) {}

  public static async open(vsCode: VSCode) {
    const config = new Configuration(vsCode);
    await config.openConfigPage();
    return config;
  }

  private async openConfigPage(): Promise<void> {
    const window = this.vsCode.getWindow();
    await this.vsCode.executeQuickCommand('Preferences: Open Settings (UI)');
    // element is not an input nor has the "contenteditable" attr, so fill can't be used
    const searchInput = window.locator('div.settings-header div.suggest-input-container');
    await searchInput.waitFor();
    const clearFilterLocator = window.getByRole('button', { name: 'Clear Settings Search Input' });
    if (await clearFilterLocator.isEnabled()) {
      await clearFilterLocator.click();
    }
    await searchInput.click();
    await searchInput.pressSequentially(`@ext:${extensionId}`);
    await this.vsCode.waitDefault();

    const openModalButton = window.getByRole('button', {
      name: 'Open Modal Editor in Main Window',
    });
    if (await openModalButton.isVisible()) {
      await openModalButton.click();
    }
  }

  public async searchConfig(configuration: string): Promise<void> {
    const window = this.vsCode.getWindow();
    const searchInput = window.locator('div.settings-header div.suggest-input-container');
    await searchInput.waitFor();
    const clearFilterLocator = window.getByRole('button', { name: 'Clear Settings Search Input' });
    if (await clearFilterLocator.isEnabled()) {
      await clearFilterLocator.click();
    }
    await searchInput.click();
    await searchInput.pressSequentially(`${configuration}`);
    await expect(window.getByLabel(configuration)).toBeVisible();
  }

  public async setEnabledConfiguration(configuration: string, enabled: boolean) {
    const window = this.vsCode.getWindow();
    try {
      const checkbox = window.getByLabel(configuration);
      if (!(await checkbox.isVisible())) {
        await this.searchConfig(configuration);
      }
      await checkbox.scrollIntoViewIfNeeded();
      await checkbox.setChecked(enabled);
    } catch (error) {
      await window.screenshot({
        path: `${SCREENSHOTS_FOLDER}/error-set-${configuration.replace(/[_"'\s]/g, '')}-to-${enabled}.png`,
      });
      throw error;
    }
  }

  public async setInputConfiguration(configuration: string, value: string) {
    const window = this.vsCode.getWindow();
    await window.getByLabel(configuration).fill(value);
  }

  public async setDropdownConfiguration(configuration: string, value: string) {
    const selectLocator = this.vsCode.getWindow().locator(`select[aria-label="${configuration}"]`);
    if (!(await selectLocator.isVisible())) {
      await this.searchConfig(configuration);
    }
    await selectLocator.selectOption({ value });
  }

  /**
   * Sets the value of a configuration input that expects a path.
   * If VSCode is running in web mode, it first uploads the file
   * @param configuration
   * @param path
   */
  public async setInputFromLocalPath(configuration: string, path: string) {
    if (this.vsCode instanceof VSCodeWeb) {
      const filename = await this.vsCode.uploadFile(path);
      path = `/projects/${this.vsCode.repoDir}/${filename}`;
      await this.vsCode.executeTerminalCommand(`chmod +x ${filename}`);
    }
    await this.setInputConfiguration(configuration, path);
  }
}
