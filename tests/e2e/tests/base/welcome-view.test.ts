import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { KAIViews } from '../../enums/views.enum';
import { extensionShortName } from '../../utilities/utils';

test.describe('Welcome View', { tag: ['@tier3', '@experimental'] }, () => {
  let vscodeApp: VSCode;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(300000);
    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
  });

  test('Welcome message is visible in sidebar', async () => {
    // Open the sidebar by clicking on the activity bar icon
    await vscodeApp.openLeftBarElement(VSCode.COMMAND_CATEGORY);

    const window = vscodeApp.getWindow();

    // The welcome view content appears in the sidebar tree view panel
    const welcomeContent = window.locator('.welcome-view-content');
    await expect(welcomeContent).toBeVisible({ timeout: 30000 });

    // Verify the welcome message text is present
    await expect(welcomeContent.getByText(`Welcome to ${extensionShortName}!`)).toBeVisible({
      timeout: 10000,
    });
    await expect(
      welcomeContent.getByText('Get started with your migration analysis.')
    ).toBeVisible();
  });

  test('"Open Analysis Panel" link opens Analysis View', async () => {
    // Ensure we're on the sidebar
    await vscodeApp.openLeftBarElement(VSCode.COMMAND_CATEGORY);

    const window = vscodeApp.getWindow();
    const welcomeContent = window.locator('.welcome-view-content');

    // Click the "Open Analysis Panel" link
    const openAnalysisLink = welcomeContent.getByRole('button', { name: 'Open Analysis Panel' });
    await expect(openAnalysisLink).toBeVisible({ timeout: 10000 });
    await openAnalysisLink.click();

    // Verify the Analysis View webview opens
    const analysisViewTab = window.locator(`div.tab[aria-label="${KAIViews.analysisView}"]`);
    await expect(analysisViewTab).toBeVisible({ timeout: 30000 });

    // Verify we can access the Analysis View content
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    await expect(analysisView.locator('[class*="pf-v"][class*="-c-page"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test('"Manage Profiles" link opens Manage Profiles view', async () => {
    // Open the sidebar again
    await vscodeApp.openLeftBarElement(VSCode.COMMAND_CATEGORY);

    const window = vscodeApp.getWindow();
    const welcomeContent = window.locator('.welcome-view-content');

    // Click the "Manage Profiles" link
    const manageProfilesLink = welcomeContent.getByRole('button', { name: 'Manage Profiles' });
    await expect(manageProfilesLink).toBeVisible({ timeout: 10000 });
    await manageProfilesLink.click();

    // Verify the Manage Profiles view opens
    const profilesViewTab = window.locator(`div.tab[aria-label="${KAIViews.manageProfiles}"]`);
    await expect(profilesViewTab).toBeVisible({ timeout: 30000 });

    // Verify we can access the Manage Profiles content
    const profilesView = await vscodeApp.getView(KAIViews.manageProfiles);
    await expect(profilesView.locator('[class*="pf-v"]').first()).toBeVisible({
      timeout: 30000,
    });
  });

  test('Documentation link is present', async () => {
    // Open the sidebar
    await vscodeApp.openLeftBarElement(VSCode.COMMAND_CATEGORY);

    const window = vscodeApp.getWindow();
    const welcomeContent = window.locator('.welcome-view-content');

    // Verify the documentation link text is present
    await expect(welcomeContent.getByText('For more information, see the')).toBeVisible({
      timeout: 10000,
    });
    await expect(welcomeContent.getByText(`${extensionShortName} documentation`)).toBeVisible({
      timeout: 10000,
    });
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
