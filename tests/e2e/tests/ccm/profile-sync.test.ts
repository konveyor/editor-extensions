import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { HubConfigurationPage } from '../../pages/hub-configuration.page';
import { generateRandomString, getHubConfig } from '../../utilities/utils';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { KAIViews } from '../../enums/views.enum';
import { SEC } from '../../utilities/consts';

test.describe(
  'Profile Sync Tests',
  {
    tag: ['@tier3', '@experimental', '@requires-minikube'],
  },
  () => {
    test.setTimeout(600000);
    let vscodeApp: VSCode;

    /**
     * This test assumes an analysis profile named "Coolstore" exists in the hub
     */
    test.beforeAll(async ({ testRepoData }) => {
      const repoInfo = testRepoData['coolstore'];
      vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
      // Create a local profile before enabling profile sync
      await vscodeApp.createProfile([], ['camel'], `Local Profile-${generateRandomString()}`);
      console.log('Created local profile "Local Profile"');
    });

    test('Enable profile sync and verify synced profile exists', async () => {
      const hubConfig = getHubConfig({
        profileSyncEnabled: true,
        solutionServerEnabled: false,
      });

      const hubConfigPage = await HubConfigurationPage.open(vscodeApp);
      await hubConfigPage.fillForm(hubConfig);

      await vscodeApp.assertNotification('Successfully connected to Hub profile sync');
      await vscodeApp.assertNotification('Active profile changed', { timeout: 60 * SEC });

      await vscodeApp.openAnalysisView();
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);

      const profileDropdown = analysisView.locator('#profile-selector-dropdown');
      await expect(profileDropdown).toBeVisible({ timeout: 10000 });
      await profileDropdown.click();

      const coolstoreProfile = analysisView.getByRole('button', {
        name: /coolstore/i,
      });
      await expect(coolstoreProfile).toBeVisible({ timeout: 10000 });
      console.log('Coolstore synced profile found in dropdown');

      // Verify local profile is NOT visible
      const localProfile = analysisView.getByRole('button', {
        name: /local profile-.*/i,
      });
      await expect(localProfile).not.toBeVisible();

      const manageProfilesButton = analysisView.locator('#manage-profiles-dropdown-item');
      await expect(manageProfilesButton).not.toBeVisible();
      console.log('Manage Profiles option is hidden');

      console.log('Trying to run an analysis');
      await vscodeApp.startServer();
      await vscodeApp.runAnalysis();
      await vscodeApp.waitForAnalysisCompleted();
      console.log('Analysis completed successfully!');
    });

    test.afterAll(async () => {
      await vscodeApp.closeVSCode();
    });
  }
);
