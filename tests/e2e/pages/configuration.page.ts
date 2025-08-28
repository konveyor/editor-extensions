import { VSCode } from './vscode.page';
import { extensionId } from '../utilities/utils';

export class Configuration {
  public constructor(private readonly vsCode: VSCode) {}

  public static async open(vsCode: VSCode) {
    const config = new Configuration(vsCode);
    const window = vsCode.getWindow();
    await vsCode.executeQuickCommand('Preferences: Open Settings (UI)');
    await window.getByRole('button', { name: `Backup and Sync Settings` }).waitFor();

    // element is not an input nor has the "contenteditable" attr, so fill can't be used
    const searchInput = window.locator('div.settings-header div.suggest-input-container');
    await searchInput.click();
    await searchInput.pressSequentially(`@ext:${extensionId}`);
    await vsCode.waitDefault();
    return config;
  }

  public async setEnabledConfiguration(configuration: string, enabled: boolean) {
    const window = this.vsCode.getWindow();
    const checkbox = window.getByLabel(configuration);
    await checkbox.setChecked(enabled);
  }

  public async setInputConfiguration(configuration: string, value: string) {
    const window = this.vsCode.getWindow();
    await window.getByLabel(configuration).fill(value);
  }

  public async setDropdownConfiguration(configuration: string, value: string) {
    const selectLocator = this.vsCode.getWindow().locator(`select[aria-label="${configuration}"]`);
    await selectLocator.selectOption({ value });
  }
}
