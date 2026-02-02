import * as pathlib from 'path';
import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { SCREENSHOTS_FOLDER } from '../../utilities/consts';
import { KAIViews } from '../../enums/views.enum';
import { generateRandomString } from '../../utilities/utils';
import { DEFAULT_PROVIDER } from '../../fixtures/provider-configs.fixture';
import * as VSCodeFactory from '../../utilities/vscode.factory';

test.describe.serial('C# Extension - Kai Integration', { tag: ['@tier3', '@experimental'] }, () => {
  let vscodeApp: VSCode;
  const randomString = generateRandomString();
  const profileName = `csharp-kai-${randomString}`;
  let repoInfo: RepoData[string];
  const screenshotDir = pathlib.join(SCREENSHOTS_FOLDER, 'csharp-kai-integration');
  let violationCountBefore: number;
  let incidentsCountBefore: number;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(1200000);
    repoInfo = testRepoData['nerd-dinner'];
    // Use openForRepo which determines initialization based on repo language
    vscodeApp = await VSCodeFactory.openForRepo(repoInfo);
    // Wait for extensions to load
    console.log('Waiting for extensions to load...');
    await vscodeApp.getWindow().waitForTimeout(15000);

    await vscodeApp.waitDefault();
    await vscodeApp.createProfile(
      repoInfo.sources,
      repoInfo.targets,
      profileName,
      repoInfo.customRulesFolder
    );
    console.log(`Profile created: ${profileName} with custom rules`);

    // Kai integration prerequisites (already covered in 02-analysis-results, but required here)
    await vscodeApp.configureGenerativeAI(DEFAULT_PROVIDER.config);
    console.log('GenAI provider configured');

    await vscodeApp.startServer();
    console.log('Server started successfully');

    test.setTimeout(600000);
    await vscodeApp.openAnalysisView();
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Click Run Analysis button directly (C# analysis may complete too fast for progress indicator)
    const runAnalysisBtn = analysisView.getByRole('button', { name: 'Run Analysis' });
    await expect(runAnalysisBtn).toBeEnabled({ timeout: 60000 });
    console.log('Clicking Run Analysis button...');
    await runAnalysisBtn.click();

    // Wait for analysis completion notification
    await vscodeApp.waitForAnalysisCompleted();
    console.log('Analysis completed');

    // Verify the Get Solution button is present
    const solutionButton = analysisView.locator('button#get-solution-button');
    await expect(solutionButton.first()).toBeVisible({ timeout: 30000 });
    console.log('Get Solution button is available');
  });

  test.beforeEach(async () => {
    const testName = test.info().title.replace(/ /g, '-');
    console.log(`Starting ${testName} at ${new Date()}`);
    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, `before-${testName}.png`),
    });
  });

  // --- Non-Agent Mode Flow ---

  test('Ensure agent mode is disabled', async () => {
    await vscodeApp.openAnalysisView();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Disable agent mode if enabled
    const agentModeSwitch = analysisView.locator('input#agent-mode-switch');
    const isChecked = await agentModeSwitch.isChecked();
    if (isChecked) {
      await agentModeSwitch.click();
      console.log('Agent mode disabled');
    } else {
      console.log('Agent mode was already disabled');
    }
  });

  test('Request and accept solution without agent mode', async () => {
    test.setTimeout(600000);
    await vscodeApp.openAnalysisView();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Count violations before fix
    const violations = analysisView.locator('[class*="pf-v"][class*="-c-card__header-toggle"]');
    violationCountBefore = await violations.count();
    console.log(`Violations before fix: ${violationCountBefore}`);
    incidentsCountBefore = await vscodeApp.getIncidentsCount();
    console.log(`Incidents before fix: ${incidentsCountBefore}`);

    // Search for a violation to fix (adjust based on actual C# issues found)
    // If no issues are found, this test will need to be adjusted
    if (violationCountBefore > 0) {
      // Get the first violation title to search for
      const firstViolation = violations.first();
      const violationText = await firstViolation.textContent();
      if (violationText) {
        console.log(`Searching for violation: ${violationText.trim()}`);
        await vscodeApp.searchViolation(violationText.trim());
        // Wait for search results to update
        await vscodeApp.waitDefault();
      }

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'after-search-violation.png'),
      });

      // Click the Get Solution button for the specific issue (scope="issue")
      // After searching, there may still be multiple buttons visible, so use .first()
      const fixButton = analysisView
        .locator('button#get-solution-button[data-scope="issue"]')
        .first();
      await expect(fixButton).toBeVisible({ timeout: 30000 });
      await fixButton.click();
      console.log('Fix button clicked for C# issue');

      const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
      await vscodeApp.waitDefault();

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'resolution-view-before-solution.png'),
      });

      // Wait for solution generation to complete (loading indicator disappears)
      const loadingIndicator = resolutionView.locator('.loading-indicator');
      console.log('Waiting for solution generation to complete...');
      await expect(loadingIndicator).toHaveCount(0, { timeout: 600000 });
      console.log('Solution generation completed');

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'solution-ready.png'),
      });

      // Click Accept button
      const acceptButton = resolutionView.getByRole('button', { name: 'Accept' }).first();
      await expect(acceptButton).toBeVisible({ timeout: 30000 });
      await acceptButton.click();
      console.log('Accept button clicked');

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'changes-accepted.png'),
      });

      await vscodeApp.waitDefault();
      console.log('Solution accepted (non-agent mode)');
    } else {
      console.log('No violations found to fix - skipping solution request');
    }
  });

  test('Return to analysis view and verify state', async () => {
    await vscodeApp.openAnalysisView();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Count violations after fix
    const violations = analysisView.locator('[class*="pf-v"][class*="-c-card__header-toggle"]');
    const violationCountAfter = await violations.count();
    console.log(`Violations after fix: ${violationCountAfter}`);
    const incidentsCountAfter = await vscodeApp.getIncidentsCount();
    console.log(`Incidents after fix: ${incidentsCountAfter}`);

    // Verify violations decreased (if we had violations to fix)
    if (violationCountBefore > 0) {
      expect(violationCountAfter).toBeLessThan(violationCountBefore);
      console.log(`Violations reduced from ${violationCountBefore} to ${violationCountAfter}`);
      expect(incidentsCountAfter).toBeLessThan(incidentsCountBefore);
      console.log(`Incidents reduced from ${incidentsCountBefore} to ${incidentsCountAfter}`);
    } else {
      console.log('No violations were fixed (none were found initially)');
    }

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'analysis-view-final-state.png'),
    });

    console.log('Analysis view is functional after Kai integration');
  });

  test.afterEach(async () => {
    const testName = test.info().title.replace(/ /g, '-');
    console.log(`Finished ${testName} at ${new Date()}`);
    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, `after-${testName}.png`),
    });
  });

  test.afterAll(async () => {
    await vscodeApp.deleteProfile(profileName);
    await vscodeApp.closeVSCode();
  });
});
