import { VSCode } from './vscode.page';
import { HubConfiguration } from '../types/hub-configuration';
import { KAIViews } from '../enums/views.enum';
import { expect } from '@playwright/test';

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
    await this.vsCode.openConfiguration();
    const view = await this.vsCode.getView(KAIViews.analysisView);
    await view.getByRole('button', { name: 'Configure Hub Settings' }).click();
  }

  /**
   * Fills the hub configuration form based on provided config.
   * Toggles are only clicked when current state differs from desired state.
  */
  public async fillForm(config: HubConfiguration) {
    const view = await this.vsCode.getView(KAIViews.hubConfiguration);
    const hubGroup = view
      .locator('.pf-v6-c-form__group')
      .filter({ has: view.getByText('Enable Hub', { exact: true }) })
      .first();

    const input = hubGroup.locator('input#hub-enabled');
    const label = hubGroup.locator('label.pf-v6-c-switch[for="hub-enabled"]');

    if ((await input.isChecked()) !== config.enabled) {
      await label.click();
    }

    await expect(input).toBeChecked({ checked: config.enabled });

    if (!config.enabled) {
      console.log('HubConfigurationPage: hub connection disabled, skipping config...');
      return;
    }
    
    await view.locator('#hub-url').fill(config.url);

    //Authentication (optional, only for remote servers)
    if (config.auth) {
      const authGroup = view
        .locator('.pf-v6-c-form__group')
        .filter({ has: view.getByText('Enable authentication', { exact: true }) })
        .first();

      const authInput = authGroup.locator('input#auth-enabled');
      const authLabel = authGroup.locator('label.pf-v6-c-switch[for="auth-enabled"]');

      if ((await authInput.isChecked()) !== config.auth.enabled) {
        await authLabel.click();
      }
      await expect(authInput).toBeChecked({ checked: config.auth.enabled });

      if (config.auth.enabled) {
        await view.locator('#auth-username').fill(config.auth.username);
        await view.locator('#auth-password').fill(config.auth.password);
      }
    }
    
    //SSL Settings
    const insecureGroup = view
      .locator('.pf-v6-c-form__group')
      .filter({ has: view.getByText('Insecure connection', { exact: true }) })
      .first();

    const insecureInput = insecureGroup.locator('input#auth-insecure');
    const insecureLabel = insecureGroup.locator('label.pf-v6-c-switch[for="auth-insecure"]');

    if ((await insecureInput.isChecked()) !== config.skipSSL) {
      await insecureLabel.click();
    }
    await expect(insecureInput).toBeChecked({ checked: config.skipSSL });

    await view.locator('#feature-solution-server').setChecked(config.solutionServerEnabled);
    const group = view
      .locator('.pf-v6-c-form__group')
      .filter({ has: view.getByText('Profile Sync', { exact: true }) })
      .first();

    const profileSyncInput = group.locator('input#feature-profile-sync');
    const profileSyncLabel = group.locator('label[for="feature-profile-sync"]');

    if ((await profileSyncInput.isChecked()) !== config.profileSyncEnabled) {
      await profileSyncLabel.click();
    }

    const saveBtn = view.getByRole('button', { name: 'Save' });
    if (await saveBtn.isEnabled()) {
      await saveBtn.click();
      console.log('Hub configuration form saved');
    } else {
      console.log('Hub configuration unchanged; Save is disabled, skipping click');
    }
    console.log('Hub configuration form saved');
  }
}
