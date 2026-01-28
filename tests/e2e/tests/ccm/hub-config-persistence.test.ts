import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { HubConfigurationPage } from '../../pages/hub-configuration.page';
import { generateRandomString, getHubConfig } from '../../utilities/utils';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { KAIViews } from '../../enums/views.enum';

/**
 * Tests for Hub Configuration Persistence
 *
 * This test suite verifies that hub configuration settings are properly
 * persisted after VSCode restart. This addresses issue #1177 where hub
 * configuration would revert to default values after restarting VSCode.
 *
 * The fix ensures that when a webview signals it's ready (WEBVIEW_READY),
 * the extension sends the full current state including the persisted hubConfig
 * from Secret Storage, preventing a race condition where early messages
 * could be lost before the webview was ready to receive them.
 */
test.describe(
  'Hub Configuration Persistence Tests',
  {
    tag: ['@tier3', '@hub-config'],
  },
  () => {
    test.setTimeout(300000);
    let vscodeApp: VSCode;

    test.beforeAll(async ({ testRepoData }) => {
      const repoInfo = testRepoData['coolstore'];
      vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
      // Create a local profile before configuring hub configuration
      await vscodeApp.createProfile([], ['camel'], `Local Profile-${generateRandomString()}`);
      console.log('Created local profile "Local Profile"');
    });

    test('Hub configuration persists after VSCode restart', async () => {
      // Create unique configuration values to ensure we're testing persistence
      const uniqueUrl = `http://test-hub-${generateRandomString()}.example.com:8080`;
      const uniqueUsername = `testuser-${generateRandomString()}`;
      const uniquePassword = `testpass-${generateRandomString()}`;

      const hubConfig = getHubConfig({
        enabled: true,
        url: uniqueUrl,
        skipSSL: true,
        auth: {
          enabled: true,
          username: uniqueUsername,
          password: uniquePassword,
        },
        solutionServerEnabled: false,
        profileSyncEnabled: false,
      });

      console.log('Configuring hub settings with unique values...');
      const hubConfigPage = await HubConfigurationPage.open(vscodeApp);
      await hubConfigPage.fillForm(hubConfig);

      console.log('Verifying configuration was saved initially...');
      const view = await vscodeApp.getView(KAIViews.hubConfiguration);
      await expect(view.locator('#hub-url')).toHaveValue(uniqueUrl);
      await expect(view.locator('#auth-username')).toHaveValue(uniqueUsername);

      console.log('Reloading VSCode window to simulate restart...');
      await vscodeApp.executeQuickCommand('Developer: Reload Window');

      // Wait for extension to reinitialize after reload
      console.log('Waiting for extension to reinitialize after reload...');
      await vscodeApp.getWindow().waitForTimeout(15000);

      // Step 4: Re-open hub configuration page
      console.log('Re-opening hub configuration page after reload...');
      await HubConfigurationPage.open(vscodeApp);

      // Step 5: Verify all configuration values persisted
      console.log('Verifying configuration persisted after reload...');
      const viewAfterReload = await vscodeApp.getView(KAIViews.hubConfiguration);

      // Check hub enabled
      const hubEnabledInput = viewAfterReload.locator('input#hub-enabled');
      await expect(hubEnabledInput).toBeChecked();

      // Check URL persisted
      await expect(viewAfterReload.locator('#hub-url')).toHaveValue(uniqueUrl);

      // Check auth enabled
      const authEnabledInput = viewAfterReload.locator('input#auth-enabled');
      await expect(authEnabledInput).toBeChecked();

      // Check username persisted
      await expect(viewAfterReload.locator('#auth-username')).toHaveValue(uniqueUsername);

      // Check password persisted
      await expect(viewAfterReload.locator('#auth-password')).toHaveValue(uniquePassword);

      // Check skipSSL persisted
      const insecureInput = viewAfterReload.locator('input#auth-insecure');
      await expect(insecureInput).toBeChecked();

      // Check solution server feature
      const solutionServerInput = viewAfterReload.locator('input#feature-solution-server');
      await expect(solutionServerInput).not.toBeChecked();

      // Check profile sync feature
      const profileSyncInput = viewAfterReload.locator('input#feature-profile-sync');
      await expect(profileSyncInput).not.toBeChecked();

      console.log('✅ All configuration values persisted correctly after reload!');
    });

    test.afterAll(async () => {
      await vscodeApp.closeVSCode();
    });
  }
);
