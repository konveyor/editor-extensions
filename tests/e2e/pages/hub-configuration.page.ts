import { VSCode } from './vscode.page';
import { HubConfiguration } from '../types/hub-configuration';
import { KAIViews } from '../enums/views.enum';
import { expect, Locator } from '@playwright/test';
import pathlib from 'path';
import { SCREENSHOTS_FOLDER } from '../utilities/consts';

/**
 * Page object for automating the Hub Configuration form in VS Code.
 * Handles connection settings, authentication, and feature toggles.
 */
export class HubConfigurationPage {
  public constructor(private readonly vsCode: VSCode) {}

  public static async open(vsCode: VSCode) {
    const hubConfig = new HubConfigurationPage(vsCode);
    await hubConfig.openHubConfiguration();
    return hubConfig;
  }

  public async openHubConfiguration() {
    await this.vsCode.openAnalysisView();
    await this.vsCode.openConfiguration();
    const view = await this.vsCode.getView(KAIViews.analysisView);
    await view.locator('#configure-hub-settings-button').click();
  }

  /**
   * Fills the hub configuration form based on provided config.
   * Toggles are only clicked when current state differs from desired state.
   */
  public async fillForm(config: HubConfiguration) {
    const view = await this.vsCode.getView(KAIViews.hubConfiguration);

    const hubInput = view.locator('input#hub-enabled');

    if ((await hubInput.isChecked()) !== config.enabled) {
      await hubInput.click({ force: true });
    }

    // check if this works with pf switches
    await expect(hubInput).toBeChecked({ checked: config.enabled });

    if (!config.enabled) {
      console.log('HubConfigurationPage: hub connection disabled, skipping config...');
      return;
    }

    await view.locator('#hub-url').fill(config.url);

    if (config.auth) {
      const authInput = view.locator('input#auth-enabled');

      if ((await authInput.isChecked()) !== config.auth.enabled) {
        await authInput.click({ force: true });
      }
      await expect(authInput).toBeChecked({ checked: config.auth.enabled });

      if (config.auth.enabled) {
        await view.locator('#auth-username').fill(config.auth.username);
        await view.locator('#auth-password').fill(config.auth.password);
      }
    }

    // SSL Settings
    const insecureInput = view.locator('input#auth-insecure');

    if ((await insecureInput.isChecked()) !== config.skipSSL) {
      await insecureInput.click({ force: true });
    }
    await expect(insecureInput).toBeChecked({ checked: config.skipSSL });

    // Solution Server
    const solutionServerInput = view.locator('input#feature-solution-server');

    if ((await solutionServerInput.isChecked()) !== config.solutionServerEnabled) {
      await solutionServerInput.click({ force: true });
    }
    await expect(solutionServerInput).toBeChecked({ checked: config.solutionServerEnabled });

    // Profile Sync
    const profileSyncInput = view.locator('input#feature-profile-sync');

    if ((await profileSyncInput.isChecked()) !== config.profileSyncEnabled) {
      await profileSyncInput.click({ force: true });
    }
    await expect(profileSyncInput).toBeChecked({ checked: config.profileSyncEnabled });

    const saveBtn = view.getByRole('button', { name: 'Save' });
    if (await saveBtn.isEnabled()) {
      await saveBtn.click();
      console.log('Hub configuration form saved');
    } else {
      console.log('Hub configuration unchanged; Save is disabled, skipping click');
    }

    await view.owner().screenshot({
      path: pathlib.join(SCREENSHOTS_FOLDER, `last-hub-configuration.png`),
    });
  }
}
