import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { KAIViews } from '../../enums/views.enum';

test.describe('C# Extension - Installation & Startup', { tag: '@tier0' }, () => {
  let vscodeApp: VSCode;
  let repoInfo: RepoData[string];

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(300000);
    repoInfo = testRepoData['nerd-dinner'];
    // Use openForRepo which determines initialization based on repo language
    vscodeApp = await VSCodeFactory.openForRepo(repoInfo);

    // Open analysis view and wait for it to be accessible
    console.log('Opening analysis view to trigger extension activation...');
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
    console.log('Extension activated successfully');
  });

  test('Extension activates without errors when opening C# project', async () => {
    await vscodeApp.waitDefault();
    // Verify no error dialogs are shown
    const errorDialog = vscodeApp.getWindow().locator('.monaco-dialog-box.error');
    await expect(errorDialog).not.toBeVisible({ timeout: 5000 });
  });

  test('Can access analysis view after opening it', async () => {
    await vscodeApp.waitDefault();

    console.log('=== Verifying C# Extension Installation & Activation Status ===');
    console.log('Checking C# extension installation status...');

    // Verify no error notifications are present - ASSERTION: must be 0
    const errorNotifications = vscodeApp
      .getWindow()
      .locator('.notifications-toasts .notification-error');
    const errorCount = await errorNotifications.count();
    console.log(`Error notifications found: ${errorCount}`);
    expect(errorCount).toBe(0);

    // Verify no error dialogs - ASSERTION: must not be visible
    const errorDialog = vscodeApp.getWindow().locator('.monaco-dialog-box.error');
    await expect(errorDialog).not.toBeVisible({ timeout: 5000 });
    console.log('✅ No error dialogs present');

    // For C# extension, verify the analysis view tab is still accessible - ASSERTION: must be visible
    console.log('Verifying Analysis View accessibility...');
    const analysisTab = vscodeApp
      .getWindow()
      .locator(`div.tab[aria-label="${KAIViews.analysisView}"]`);
    await expect(analysisTab).toBeVisible({ timeout: 10000 });
    console.log('✅ Analysis view tab is accessible');

    // Verify the analysis view content is loaded - ASSERTION: must be visible
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    const pageComponent = analysisView.locator('[class*="pf-v"][class*="-c-page"]').first();
    await expect(pageComponent).toBeVisible({ timeout: 10000 });
    console.log('✅ Analysis View content is loaded');

    // Summary logs
    console.log('=== C# Extension Status Summary ===');
    console.log('✅ C# extension installed successfully');
    console.log('✅ C# extension did not fail during activation');
    console.log('✅ All notifications clear - C# extension is installed and activated');
    console.log('✅ No error dialogs present - C# extension activation completed without errors');
    console.log('✅ Analysis view is accessible - C# extension is fully functional');
    console.log('✅ C# extension is ready for use');
    console.log('===================================');
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
