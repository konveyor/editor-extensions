import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { OPENAI_PROVIDER } from '../../fixtures/provider-configs.fixture';
import { generateRandomString } from '../../utilities/utils';
import { KAIViews } from '../../enums/views.enum';
import { FixTypes } from '../../enums/fix-types.enum';

test.describe(`@tier0 Run analysis and fix one issue`, () => {
  let vscodeApp: VSCode;
  const randomString = generateRandomString();
  const profileName = `automation-${randomString}`;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(600000);
    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
    await vscodeApp.waitDefault();
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
    await vscodeApp.configureGenerativeAI(OPENAI_PROVIDER.config);
    await vscodeApp.startServer();
    await vscodeApp.waitDefault();
    await vscodeApp.runAnalysis();
    await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
      timeout: 300000,
    });
  });

  test('Fix one issue', async () => {
    test.setTimeout(300000);
    await vscodeApp.openAnalysisView();
    await vscodeApp.searchAndRequestFix('InventoryEntity', FixTypes.Incident);
    const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
    const fixLocator = resolutionView.locator('button[aria-label="Accept all changes"]').first();
    await expect(fixLocator).toBeVisible({ timeout: 60000 });
    // Ensures the button is clicked even if there are notifications overlaying it due to screen size
    await fixLocator.dispatchEvent('click');
    await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
      timeout: 300000,
    });
  });

  test.afterAll(async () => {
    await vscodeApp.deleteProfile(profileName);
    await vscodeApp.closeVSCode();
  });
});
