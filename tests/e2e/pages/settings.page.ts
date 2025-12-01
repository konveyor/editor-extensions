import { expect, Page } from '@playwright/test';
import { SettingsView } from '../enums/settings-view.enum';
import { VSCode } from './vscode.page';
import { extensionId } from '../utilities/utils';
import { LogLevel } from '../enums/LogLevel.enum';

export class Settings {
  private readonly vsCode: VSCode;
  private readonly window: Page;

  private constructor(vsCode: VSCode) {
    this.vsCode = vsCode;
    this.window = vsCode.getWindow();
  }

  /**
   * Opens the extension settings.
   * @param view - The settings view to select.
   * @param searchSettings - The settings to search for.
   */
  public async openExtensionSettings(view: SettingsView, searchSettings?: string): Promise<void> {
    await this.vsCode.executeQuickCommand('Preferences: Open Settings (UI)');
    await this.selectSettingsView(view);
    if (searchSettings) {
      await this.searchExtensionSettings(searchSettings);
    }
  }

  /**
   * Searches for settings in the extension settings.
   * @param searchSettings - The settings to search for.
   */
  public async searchExtensionSettings(searchSettings: string): Promise<void> {
    const settingsHeader = await this.window.locator('class=settings-header');
    const searchInput = settingsHeader.locator('div.suggest-input-container');
    await searchInput.fill(`@ext:${extensionId} ${searchSettings}`);
    await this.window.waitForTimeout(1000);
    const settingsCountBadge = this.window.locator(
      '.search-container-widgets .settings-count-widget.monaco-count-badge'
    );
    await expect(settingsCountBadge).toHaveText(/^\d+ Setting[s]? Found$/);
    const settingsCountText = await settingsCountBadge.textContent();
    if (settingsCountText && /^0 Setting[s]? Found$/.test(settingsCountText.trim())) {
      throw new Error(`No settings found for "${searchSettings}"`);
    }
  }

  /**
   * Selects the settings view.
   * @param view - The settings view to select.
   */
  public async selectSettingsView(view: SettingsView): Promise<void> {
    const settingsHeader = await this.window.locator('class=settings-header');
    await settingsHeader.waitFor({ state: 'visible', timeout: 10000 });
    settingsHeader.getByText(view).click();
  }

  /**
   * Selects the log level.
   * @param logLevel - The log level to select.
   */
  public async selectLogLevel(logLevel: LogLevel) {
    const logLevelSelect = this.window.locator('select[aria-label="konveyor.logLevel"]');
    await logLevelSelect.waitFor({ state: 'visible', timeout: 5000 });
    await logLevelSelect.selectOption(logLevel);
    await this.window.waitForTimeout(1000);
  }
}
