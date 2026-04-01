import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { HubConfigurationPage } from '../../pages/hub-configuration.page';
import { getHubConfig } from '../../utilities/utils';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { KAIViews } from '../../enums/views.enum';
import { SCREENSHOTS_FOLDER } from '../../utilities/consts';
import pathlib from 'path';

test.describe(
  'Hub Configuration Tests',
  {
    tag: ['@requires-minikube', '@tier2'],
  },
  () => {
    test.setTimeout(900000);
    let vscodeApp: VSCode;

    test.beforeAll(async ({ testRepoData }) => {
      test.setTimeout(600_000);
      const repoInfo = testRepoData['coolstore'];
      vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
    });

    test('Connect to Hub successfully', async () => {
      const hubConfig = getHubConfig({
        profileSyncEnabled: false,
        solutionServerEnabled: true,
      });

      const hubConfigPage = await HubConfigurationPage.open(vscodeApp);
      await hubConfigPage.fillForm(hubConfig);

      await vscodeApp.assertNotification('Successfully connected to Hub solution server');
      await vscodeApp.executeQuickCommand('Developer: Reload Window');
      await hubConfigPage.openHubConfiguration();
      const view = await vscodeApp.getView(KAIViews.hubConfiguration);
      try {
        await expect(view.locator('input#hub-enabled')).toBeChecked({ timeout: 30000 });
      } catch (error) {
        await vscodeApp.getWindow().screenshot({
          path: pathlib.join(SCREENSHOTS_FOLDER, `error-hub-config-test.png`),
        });
        if (!process.env.CI) {
          throw error;
        }
        console.log(
          'Hub configuration was not persisted, this might be due to bug https://github.com/konveyor/editor-extensions/issues/1249. Ignoring...'
        );
      }
    });

    test('Disconnect from Hub', async () => {
      const disconnectConfig = {
        enabled: false,
        url: process.env.TEST_HUB_URL || 'http://localhost:8080',
        skipSSL: true,
        solutionServerEnabled: false,
        profileSyncEnabled: false,
      };

      const hubConfigPage = await HubConfigurationPage.open(vscodeApp);
      await hubConfigPage.fillForm(disconnectConfig);

      let view = await vscodeApp.getView(KAIViews.hubConfiguration);
      const saveBtn = view.getByRole('button', { name: 'Save' });
      if (await saveBtn.isEnabled()) {
        await saveBtn.click();
        console.log('Hub configuration saved - hub disabled');
      }

      await HubConfigurationPage.open(vscodeApp);
      view = await vscodeApp.getView(KAIViews.hubConfiguration);
      await expect(view.locator('input#hub-enabled')).not.toBeChecked();

      console.log('Successfully disconnected from Hub');
    });

    test.afterAll(async () => {
      await vscodeApp.closeVSCode();
    });
  }
);
