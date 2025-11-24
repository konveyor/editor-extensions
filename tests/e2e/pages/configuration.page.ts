import { VSCode } from './vscode.page';
import { VSCodeDesktop } from './vscode-desktop.page';
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
    if (this.vsCode instanceof VSCodeDesktop) {
      await this.vsCode.SetUpSolutionServer(enabled);
    } else {
      throw new Error('Solution Server initialization is not available in VSCode Web.');
    }
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
