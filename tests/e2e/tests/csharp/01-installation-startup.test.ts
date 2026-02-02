import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { KAIViews } from '../../enums/views.enum';

test.describe.serial('C# Extension - Installation & Startup', { tag: '@tier3' }, () => {
  let vscodeApp: VSCode;
  let repoInfo: RepoData[string];

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(300000);
    repoInfo = testRepoData['nerd-dinner'];
    // Use openForRepo which determines initialization based on repo language
    vscodeApp = await VSCodeFactory.openForRepo(repoInfo);

    // Open analysis view and wait for it to be accessible
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitDefault();

    // Verify no error dialogs during activation - ASSERTION: must not be visible
    const errorDialog = vscodeApp.getWindow().locator('.monaco-dialog-box.error');
    await expect(errorDialog).not.toBeVisible({ timeout: 5000 });

    // Wait for the analysis view to be fully loaded using assertion - ASSERTION: must be visible
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    await expect(analysisView.locator('[class*="pf-v"][class*="-c-page"]').first()).toBeVisible({
      timeout: 60000,
    });
    console.log('C# extension activated');
  });

  test('Can access analysis view after opening it', async () => {
    await vscodeApp.waitDefault();

    // Verify no error notifications are present - ASSERTION: must be 0
    const errorNotifications = vscodeApp
      .getWindow()
      .locator('.notifications-toasts .notification-error');
    const errorCount = await errorNotifications.count();
    expect(errorCount).toBe(0);

    // Verify no error dialogs - ASSERTION: must not be visible
    const errorDialog = vscodeApp.getWindow().locator('.monaco-dialog-box.error');
    await expect(errorDialog).not.toBeVisible({ timeout: 5000 });

    // For C# extension, verify the analysis view tab is still accessible - ASSERTION: must be visible
    const analysisTab = vscodeApp
      .getWindow()
      .locator(`div.tab[aria-label="${KAIViews.analysisView}"]`);
    await expect(analysisTab).toBeVisible({ timeout: 10000 });

    // Verify the analysis view content is loaded - ASSERTION: must be visible
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    const pageComponent = analysisView.locator('[class*="pf-v"][class*="-c-page"]').first();
    await expect(pageComponent).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
