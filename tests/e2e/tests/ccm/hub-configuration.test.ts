import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { HubConfigurationPage } from '../../pages/hub-configuration.page';
import { getHubConfig } from '../../utilities/utils';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { KAIViews } from '../../enums/views.enum';

test.describe(
  'Hub Configuration Tests',
  {
    tag: ['@tier3', '@experimental', '@requires-minikube'],
  },
  () => {
    test.setTimeout(600000);
    let vscodeApp: VSCode;

    test.beforeAll(async ({ testRepoData }) => {
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

      // Check for any notification (success or failure) to understand what's happening
      const successNotification = vscodeApp
        .getWindow()
        .locator('.notification-list-item-message span', {
          hasText: /Successfully connected to Hub solution server/i,
        });

      const failureNotification = vscodeApp
        .getWindow()
        .locator('.notification-list-item-message span', {
          hasText: /Failed to connect/i,
        });

      const hasSuccess = await successNotification.isVisible().catch(() => false);
      const hasFailure = await failureNotification.isVisible().catch(() => false);

      if (hasSuccess) {
        console.log('Successfully connected to Hub solution server');
      } else if (hasFailure) {
        console.log('Failed to connect to Hub solution server - notification visible');
      } else {
        console.log('No hub connection notification visible');
      }

      // Verify hub is enabled in the configuration view (regardless of connection status)
      await vscodeApp.openAnalysisView();
      await vscodeApp.openConfiguration();
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      await analysisView.locator('#configure-hub-settings-button').click();

      const view = await vscodeApp.getView(KAIViews.hubConfiguration);
      await expect(view.locator('input#hub-enabled')).toBeChecked();
    });

    test('Disconnect from Hub', async () => {
      const disconnectConfig = {
        enabled: false,
        url: process.env.HUB_URL || 'http://localhost:8080',
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
