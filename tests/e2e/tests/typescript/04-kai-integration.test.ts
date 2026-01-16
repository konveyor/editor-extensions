import * as pathlib from 'path';
import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { SCREENSHOTS_FOLDER } from '../../utilities/consts';
import { KAIViews } from '../../enums/views.enum';
import { generateRandomString } from '../../utilities/utils';
import { DEFAULT_PROVIDER } from '../../fixtures/provider-configs.fixture';
import * as VSCodeFactory from '../../utilities/vscode.factory';

test.describe.serial('TypeScript Extension - Kai Integration', () => {
  let vscodeApp: VSCode;
  const randomString = generateRandomString();
  const profileName = `ts-kai-${randomString}`;
  let repoInfo: RepoData[string];
  const screenshotDir = pathlib.join(SCREENSHOTS_FOLDER, 'typescript-kai-integration');
  let violationCountBefore: number;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(1200000);
    repoInfo = testRepoData['static-report'];
    // Use openForRepo which determines initialization based on repo language
    vscodeApp = await VSCodeFactory.openForRepo(repoInfo);
    // Wait for extensions to load
    console.log('Waiting for extensions to load...');
    await vscodeApp.getWindow().waitForTimeout(15000);
  });

  test.beforeEach(async () => {
    const testName = test.info().title.replace(/ /g, '-');
    console.log(`Starting ${testName} at ${new Date()}`);
    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, `before-${testName}.png`),
    });
  });

  test('Create profile with PatternFly rulesets', async () => {
    await vscodeApp.waitDefault();
    await vscodeApp.createProfile(
      repoInfo.sources,
      repoInfo.targets,
      profileName,
      repoInfo.customRulesFolder
    );
    console.log(`Profile created: ${profileName} with custom rules`);
  });

  test('Configure GenAI Provider', async () => {
    await vscodeApp.configureGenerativeAI(DEFAULT_PROVIDER.config);
    console.log('GenAI provider configured');
  });

  test('Start server', async () => {
    await vscodeApp.startServer();
    console.log('Server started successfully');
  });

  test('Run analysis', async () => {
    test.setTimeout(600000);
    await vscodeApp.waitDefault();
    await vscodeApp.openAnalysisView();
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Click Run Analysis button directly (TypeScript analysis may complete too fast for progress indicator)
    const runAnalysisBtn = analysisView.getByRole('button', { name: 'Run Analysis' });
    await expect(runAnalysisBtn).toBeEnabled({ timeout: 60000 });
    console.log('Clicking Run Analysis button...');
    await runAnalysisBtn.click();

    // Wait for analysis completion notification
    await vscodeApp.waitForAnalysisCompleted();
    console.log('Analysis completed');
  });

  test('Verify issues are available for Kai processing', async () => {
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitDefault();

    // Verify the Get Solution button is present
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    const solutionButton = analysisView.locator('button#get-solution-button');
    await expect(solutionButton.first()).toBeVisible({ timeout: 30000 });
    console.log('Get Solution button is available');
  });

  // --- Non-Agent Mode Flow ---

  test('Ensure agent mode is disabled', async () => {
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitDefault();

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
    await vscodeApp.waitDefault();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Count violations before fix
    const violations = analysisView.locator('.pf-v6-c-card__header-toggle');
    violationCountBefore = await violations.count();
    console.log(`Violations before fix: ${violationCountBefore}`);

    // Search for the specific violation to fix
    const violationText = 'The theme prop has been removed from PageSidebar';
    await vscodeApp.searchViolation(violationText);

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'after-search-violation.png'),
    });

    // Click the Get Solution button for the specific issue (scope="issue")
    const fixButton = analysisView.locator('button#get-solution-button[data-scope="issue"]');
    await expect(fixButton).toBeVisible({ timeout: 30000 });
    await fixButton.click();
    console.log('Fix button clicked for PageSidebar theme prop issue');

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
  });

  test('Return to analysis view and verify state', async () => {
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitDefault();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Count violations after fix
    const violations = analysisView.locator('.pf-v6-c-card__header-toggle');
    const violationCountAfter = await violations.count();
    console.log(`Violations after fix: ${violationCountAfter}`);

    // Verify violations decreased
    expect(violationCountAfter).toBeLessThan(violationCountBefore);
    console.log(`Violations reduced from ${violationCountBefore} to ${violationCountAfter}`);

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'analysis-view-final-state.png'),
    });

    console.log('Analysis view is functional after Kai integration');
  });

  test('Delete profile', async () => {
    await vscodeApp.deleteProfile(profileName);
    console.log(`Profile deleted: ${profileName}`);
  });

  test.afterEach(async () => {
    const testName = test.info().title.replace(/ /g, '-');
    console.log(`Finished ${testName} at ${new Date()}`);
    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, `after-${testName}.png`),
    });
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
