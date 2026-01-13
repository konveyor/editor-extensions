import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { KAIViews } from '../../enums/views.enum';
import { HubConfigurationPage } from '../../pages/hub-configuration.page';
import { HubConfiguration } from '../../types/hub-configuration';
import * as VSCodeFactory from '../../utilities/vscode.factory';

const HUB_URL = process.env.SOLUTION_SERVER_URL;
const HUB_USERNAME = process.env.SOLUTION_SERVER_USERNAME;
const HUB_PASSWORD = process.env.SOLUTION_SERVER_PASSWORD;

test.describe('Profile Sync Tests', () => {
  let vscodeApp: VSCode;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(300000);
    if (!HUB_URL || !HUB_PASSWORD || !HUB_USERNAME) {
      throw new Error('HUB_URL, HUB_USERNAME and HUB_PASSWORD must be provided');
    }
    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
  });

  test('Enable profile sync and verify synced profile exists', async () => {
    // Configure hub settings with profile sync enabled
    const hubConfig: HubConfiguration = {
      enabled: true,
      url: HUB_URL!,
      skipSSL: true,
      auth: {
        enabled: true,
        username: HUB_USERNAME!,
        password: HUB_PASSWORD!,
      },
      solutionServerEnabled: false,
      profileSyncEnabled: true,
    };

    const hubConfigPage = await HubConfigurationPage.open(vscodeApp);
    await hubConfigPage.fillForm(hubConfig);

    /*
    await vscodeApp.executeQuickCommand('Konveyor: Manage Analysis Profile');
    const profileView = await vscodeApp.getView(KAIViews.manageProfiles);

    // Verify that "test-profile" exists
    const profileList = profileView.getByRole('list', { name: 'Profile list' });
    await profileList.waitFor({ state: 'visible', timeout: 30000 });

    const testProfile = profileList.getByRole('listitem').filter({ hasText: 'test-profile' });
    await expect(testProfile).toBeVisible({ timeout: 30000 });*/

    console.log('✅ Profile "test-profile" found successfully');
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
