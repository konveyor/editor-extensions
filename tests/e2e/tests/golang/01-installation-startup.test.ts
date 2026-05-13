import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { KAIViews } from '../../enums/views.enum';

test.describe(
  'Golang Extension - Installation & Startup',
  { tag: ['@tier3', '@experimental'] },
  () => {
    let vscodeApp: VSCode;
    let repoInfo: RepoData[string];

    test.beforeAll(async ({ testRepoData }) => {
      test.setTimeout(300000);
      repoInfo = testRepoData['gotest'];
      // Use openForRepo which determines initialization based on repo language
      vscodeApp = await VSCodeFactory.openForRepo(repoInfo);

      // Open analysis view and wait for it to be accessible
      console.log('Opening analysis view to trigger extension activation...');
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitDefault();

      // Wait for the analysis view to be fully loaded using assertion
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      await expect(analysisView.locator('[class*="pf-v"][class*="-c-page"]').first()).toBeVisible({
        timeout: 60000,
      });
      console.log('Extension activated successfully');
    });

    test('Extension activates without errors when opening Go project', async () => {
      await vscodeApp.waitDefault();
      // Verify no error dialogs are shown
      const errorDialog = vscodeApp.getWindow().locator('.monaco-dialog-box.error');
      await expect(errorDialog).not.toBeVisible({ timeout: 5000 });
    });

    test('Can access analysis view after opening it', async () => {
      await vscodeApp.waitDefault();
      // For Go extension, verify the analysis view tab is still accessible
      const analysisTab = vscodeApp
        .getWindow()
        .locator(`div.tab[aria-label="${KAIViews.analysisView}"]`);
      await expect(analysisTab).toBeVisible({ timeout: 10000 });
    });

    test.afterAll(async () => {
      await vscodeApp.closeVSCode();
    });
  }
);
