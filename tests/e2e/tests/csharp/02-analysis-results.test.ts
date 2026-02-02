import * as pathlib from 'path';
import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { DEFAULT_PROVIDER } from '../../fixtures/provider-configs.fixture';
import { generateRandomString } from '../../utilities/utils';
import { KAIViews } from '../../enums/views.enum';
import { SCREENSHOTS_FOLDER } from '../../utilities/consts';

test.describe.serial('C# Extension - Analysis Execution & Results', { tag: '@tier3' }, () => {
  let vscodeApp: VSCode;
  const randomString = generateRandomString();
  const profileName = `csharp-analysis-${randomString}`;
  let repoInfo: RepoData[string];
  const screenshotDir = pathlib.join(SCREENSHOTS_FOLDER, 'csharp-analysis-results');

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(1200000);
    repoInfo = testRepoData['nerd-dinner'];
    if (!repoInfo) {
      throw new Error("'nerd-dinner' fixture is missing from test-repos.json");
    }
    // Use openForRepo which determines initialization based on repo language
    vscodeApp = await VSCodeFactory.openForRepo(repoInfo);
    // Wait for extensions to load
    console.log('Waiting for extensions to load...');
    await vscodeApp.getWindow().waitForTimeout(15000);

    await vscodeApp.createProfile(
      repoInfo.sources,
      repoInfo.targets,
      profileName,
      repoInfo.customRulesFolder
    );
    console.log(`Profile created: ${profileName} with custom rules`);
  });

  test.beforeEach(async () => {
    const testName = test.info().title.replace(/ /g, '-');
    console.log(`Starting ${testName} at ${new Date()}`);
    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, `before-${testName}.png`),
    });
  });

  test('Configure GenAI Provider', async () => {
    await vscodeApp.configureGenerativeAI(DEFAULT_PROVIDER.config);
    console.log('GenAI provider configured');
  });

  test('Start server', async () => {
    await vscodeApp.startServer();
    console.log('Server started successfully');
  });

  test('Run analysis on nerd-dinner repo', async () => {
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
    console.log('Analysis completed successfully');
  });

  test('Verify analysis results are displayed', async () => {
    await vscodeApp.openAnalysisView();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Verify PatternFly page structure is intact
    const pageComponent = analysisView.locator('[class*="pf-v"][class*="-c-page"]').first();
    await expect(pageComponent).toBeVisible({ timeout: 10000 });

    // Verify drawer component shows results
    const drawer = analysisView.locator('[class*="pf-v"][class*="-c-drawer"]').first();
    await expect(drawer).toBeVisible({ timeout: 5000 });

    // Verify toolbar is present
    const toolbar = analysisView.locator('[class*="pf-v"][class*="-c-toolbar"]').first();
    await expect(toolbar).toBeVisible({ timeout: 10000 });

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'analysis-results-displayed.png'),
    });

    console.log('Analysis results view structure is correct');
  });

  test('Verify Get Solution button is visible', async () => {
    await vscodeApp.openAnalysisView();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Verify the Get Solution button is visible (indicates GenAI is enabled)
    const solutionButton = analysisView.locator('button#get-solution-button');
    await expect(solutionButton.first()).toBeVisible({ timeout: 30000 });

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'get-solution-button-visible.png'),
    });

    console.log('Get Solution button is visible');
  });

  test('Verify issues count matches expected', async () => {
    await vscodeApp.openAnalysisView();

    const issuesCount = await vscodeApp.getIssuesCount();
    console.log(`Issues count from UI: ${issuesCount}, expected: ${repoInfo.issuesCount}`);

    // Verify issues count matches the expected count from test-repos.json
    expect(issuesCount).toBe(repoInfo.issuesCount);

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'issues-count-verified.png'),
    });
  });

  test('Verify incidents count matches expected', async () => {
    await vscodeApp.openAnalysisView();

    const incidentsCount = await vscodeApp.getIncidentsCount();
    console.log(`Incidents count from UI: ${incidentsCount}, expected: ${repoInfo.incidentsCount}`);

    // Verify incidents count matches the expected count from test-repos.json
    expect(incidentsCount).toBe(repoInfo.incidentsCount);

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'incidents-count-verified.png'),
    });
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
