import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { KAIViews } from '../../enums/views.enum';

test.describe('TypeScript Extension - Installation & Startup', () => {
  let vscodeApp: VSCode;
  let repoInfo: RepoData[string];

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(300000);
    repoInfo = testRepoData['static-report'];
    // Use openForRepo which determines initialization based on repo language
    vscodeApp = await VSCodeFactory.openForRepo(repoInfo);
    // Wait longer for extensions to fully load and activate
    console.log('Waiting for extensions to load...');
    await vscodeApp.getWindow().waitForTimeout(15000);

    // Open analysis view and wait for webview content to load
    console.log('Opening analysis view to trigger extension activation...');
    await vscodeApp.openAnalysisView();
    await vscodeApp.getWindow().waitForTimeout(10000);
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });

  test('Extension activates without errors when opening TypeScript project', async () => {
    await vscodeApp.waitDefault();
    // Verify no error dialogs are shown
    const errorDialog = vscodeApp.getWindow().locator('.monaco-dialog-box.error');
    await expect(errorDialog).not.toBeVisible({ timeout: 5000 });
  });

  //   // Focus on the editor first to ensure command palette works
  //   await vscodeApp.getWindow().locator('body').focus();
  //   await vscodeApp.waitDefault();

  //   // Open command palette and type the command
  //   const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  //   await vscodeApp.getWindow().keyboard.press(`${modifier}+Shift+P`);
  //   await vscodeApp.getWindow().waitForTimeout(1000);

  //   // Type the command to search for
  //   const commandToSearch = 'Konveyor';
  //   await vscodeApp.getWindow().keyboard.type(commandToSearch, { delay: 50 });
  //   await vscodeApp.getWindow().waitForTimeout(1000);

  //   // Check that Konveyor commands appear in the list
  //   const commandItems = vscodeApp.getWindow().locator('.quick-input-list-entry').first();
  //   await expect(commandItems).toBeVisible({ timeout: 10000 });

  //   // Press Escape to close the command palette
  //   await vscodeApp.getWindow().keyboard.press('Escape');
  //   await vscodeApp.waitDefault();
  // });

  test('Can access analysis view after opening it', async () => {
    await vscodeApp.waitDefault();
    // For TypeScript extension, verify the analysis view tab is still accessible
    const analysisTab = vscodeApp
      .getWindow()
      .locator(`div.tab[aria-label="${KAIViews.analysisView}"]`);
    await expect(analysisTab).toBeVisible({ timeout: 10000 });
  });
});
