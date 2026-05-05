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
    vscodeApp = await VSCodeFactory.openForRepo(repoInfo);

    await vscodeApp.openAnalysisView();
    await vscodeApp.waitDefault();

    const errorDialog = vscodeApp.getWindow().locator('.monaco-dialog-box.error');
    await expect(errorDialog).not.toBeVisible({ timeout: 5000 });

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    await expect(analysisView.locator('[class*="pf-v"][class*="-c-page"]').first()).toBeVisible({
      timeout: 60000,
    });
  });

  test('Can access analysis view after opening it', async () => {
    const errorNotifications = vscodeApp
      .getWindow()
      .locator('.notifications-toasts .notification-error');
    const errorCount = await errorNotifications.count();
    expect(errorCount).toBe(0);

    const errorDialog = vscodeApp.getWindow().locator('.monaco-dialog-box.error');
    await expect(errorDialog).not.toBeVisible({ timeout: 5000 });

    const analysisTab = vscodeApp
      .getWindow()
      .locator(`div.tab[aria-label="${KAIViews.analysisView}"]`);
    await expect(analysisTab).toBeVisible({ timeout: 10000 });

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    const pageComponent = analysisView.locator('[class*="pf-v"][class*="-c-page"]').first();
    await expect(pageComponent).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
