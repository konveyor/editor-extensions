import * as pathlib from 'path';
import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { SCREENSHOTS_FOLDER } from '../../utilities/consts';
import { KAIViews } from '../../enums/views.enum';
import { generateRandomString } from '../../utilities/utils';
import { DEFAULT_PROVIDER } from '../../fixtures/provider-configs.fixture';
import * as VSCodeFactory from '../../utilities/vscode.factory';

test.describe.serial(
  'Golang Extension - E2E Workflow',
  { tag: ['@tier3', '@experimental'] },
  () => {
    let vscodeApp: VSCode;
    const randomString = generateRandomString();
    const profileName = `go-e2e-${randomString}`;
    let repoInfo: RepoData[string];
    const screenshotDir = pathlib.join(SCREENSHOTS_FOLDER, 'golang-e2e-workflow');
    let violationCountBefore: number;

    test.beforeAll(async ({ testRepoData }) => {
      test.setTimeout(1200000);
      repoInfo = testRepoData['gotest'];
      if (!repoInfo) {
        throw new Error("'gotest' fixture is missing from test-repos.json");
      }
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

    // --- Setup Phase ---

    test('Create profile with Kubernetes migration rulesets', async () => {
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

      // Click Run Analysis button directly (Go analysis may complete quickly)
      const runAnalysisBtn = analysisView.getByRole('button', { name: 'Run Analysis' });
      await expect(runAnalysisBtn).toBeEnabled({ timeout: 60000 });
      console.log('Clicking Run Analysis button...');
      await runAnalysisBtn.click();

      // Wait for analysis completion notification
      await vscodeApp.waitForAnalysisCompleted();
      console.log('Analysis completed');
    });

    // --- UI Verification Phase ---

    test('Verify analysis view is accessible', async () => {
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitDefault();

      const analysisView = await vscodeApp.getView(KAIViews.analysisView);

      // Verify the analysis view has expected UI elements
      const buttons = analysisView.locator('button');
      const buttonCount = await buttons.count();
      console.log(`Found ${buttonCount} buttons in analysis view`);
      expect(buttonCount).toBeGreaterThan(0);

      // Verify PatternFly components are rendered
      const pfComponents = analysisView.locator('[class*="pf-v"]');
      const pfCount = await pfComponents.count();
      console.log(`Found ${pfCount} PatternFly components`);
      expect(pfCount).toBeGreaterThan(0);

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'analysis-view-accessible.png'),
      });
    });

    test('Verify analysis results are displayed', async () => {
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitDefault();

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

    // --- Results Verification Phase ---

    test('Verify issues count matches expected', async () => {
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitDefault();

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
      await vscodeApp.waitDefault();

      const incidentsCount = await vscodeApp.getIncidentsCount();
      console.log(
        `Incidents count from UI: ${incidentsCount}, expected: ${repoInfo.incidentsCount}`
      );

      // Verify incidents count matches the expected count from test-repos.json
      expect(incidentsCount).toBe(repoInfo.incidentsCount);

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'incidents-count-verified.png'),
      });
    });

    test('Verify specific issue has correct incidents count', async () => {
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitDefault();

      // Get all issues from the UI
      const allIssues = await vscodeApp.getAllIssues();
      console.log(`Found ${allIssues.length} issues in UI`);

      // Pick a specific issue from test-repos.json to verify (using autoscaling deprecation)
      const expectedIssue = repoInfo.issues.find((issue) =>
        issue.title.includes('Migrate deprecated autoscaling')
      );
      expect(expectedIssue).toBeDefined();

      // Find this issue in the UI results
      const foundIssue = allIssues.find((issue) =>
        issue.title.includes('Migrate deprecated autoscaling')
      );
      expect(foundIssue).toBeDefined();
      expect(foundIssue!.incidentsCount).toBe(expectedIssue!.incidentsCount);

      console.log(
        `Verified issue containing "Migrate deprecated autoscaling" has ${foundIssue!.incidentsCount} incidents (expected: ${expectedIssue!.incidentsCount})`
      );

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'specific-issue-verified.png'),
      });
    });

    // --- Kai Integration Phase ---

    test('Verify Get Solution button is available', async () => {
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitDefault();

      // Verify the Get Solution button is present
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      const solutionButton = analysisView.locator('button#get-solution-button');
      await expect(solutionButton.first()).toBeVisible({ timeout: 30000 });
      console.log('Get Solution button is available');
    });

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

    test('Fix autoscaling issue and accept solution', async () => {
      test.setTimeout(600000);
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitDefault();

      const analysisView = await vscodeApp.getView(KAIViews.analysisView);

      // Count issues before fix using the proper method
      violationCountBefore = await vscodeApp.getIssuesCount();
      console.log(`Issues before fix: ${violationCountBefore}`);

      // Search for the specific violation to fix (autoscaling v2beta1 deprecation)
      const violationText = 'Migrate deprecated autoscaling';
      await vscodeApp.searchViolation(violationText);

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'after-search-autoscaling-violation.png'),
      });

      // Click the Get Solution button for the specific issue (scope="issue")
      const fixButton = analysisView.locator('button#get-solution-button[data-scope="issue"]');
      await expect(fixButton).toBeVisible({ timeout: 30000 });
      await fixButton.click();
      console.log('Fix button clicked for autoscaling v2beta1 migration issue');

      const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
      await vscodeApp.waitDefault();

      // Wait for solution generation to complete (loading indicator disappears)
      const loadingIndicator = resolutionView.locator('.loading-indicator');
      console.log('Waiting for autoscaling solution generation to complete...');
      await expect(loadingIndicator).toHaveCount(0, { timeout: 600000 });
      console.log('Autoscaling solution generation completed');

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'autoscaling-solution-ready.png'),
      });

      // Click Accept button
      const acceptButton = resolutionView.getByRole('button', { name: 'Accept' }).first();
      await expect(acceptButton).toBeVisible({ timeout: 30000 });
      await acceptButton.click();
      console.log('Autoscaling fix accepted');

      await vscodeApp.waitDefault();
    });

    test('Verify issues reduced after autoscaling fix', async () => {
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitDefault();

      // Clear the search filter to see all remaining issues
      await vscodeApp.searchViolation('');
      await vscodeApp.waitDefault();

      // Count issues after autoscaling fix
      const issueCountAfter = await vscodeApp.getIssuesCount();
      console.log(`Issues after autoscaling fix: ${issueCountAfter}`);

      // Verify issues were reduced (autoscaling fix resolves 2 issues)
      expect(issueCountAfter).toBeLessThan(violationCountBefore);
      console.log(`Issues reduced from ${violationCountBefore} to ${issueCountAfter}`);

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'after-autoscaling-fix-verified.png'),
      });
    });

    test('Fix dependency issue and accept solution', async () => {
      test.setTimeout(600000);
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitDefault();

      const analysisView = await vscodeApp.getView(KAIViews.analysisView);

      // Clear search and find the dependency issue
      await vscodeApp.searchViolation('');
      await vscodeApp.waitDefault();

      // Search for the dependency violation (client-go version)
      const violationText = 'Update Kubernetes client-go';
      await vscodeApp.searchViolation(violationText);

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'after-search-dependency-violation.png'),
      });

      // Click the Get Solution button for the specific issue (scope="issue")
      const fixButton = analysisView.locator('button#get-solution-button[data-scope="issue"]');
      await expect(fixButton).toBeVisible({ timeout: 30000 });
      await fixButton.click();
      console.log('Fix button clicked for client-go dependency issue');

      const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
      await vscodeApp.waitDefault();

      // Wait for solution generation to complete (loading indicator disappears)
      const loadingIndicator = resolutionView.locator('.loading-indicator');
      console.log('Waiting for dependency solution generation to complete...');
      await expect(loadingIndicator).toHaveCount(0, { timeout: 600000 });
      console.log('Dependency solution generation completed');

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'dependency-solution-ready.png'),
      });

      // Click Accept button
      const acceptButton = resolutionView.getByRole('button', { name: 'Accept' }).first();
      await expect(acceptButton).toBeVisible({ timeout: 30000 });
      await acceptButton.click();
      console.log('Dependency fix accepted');

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'all-fixes-accepted.png'),
      });

      await vscodeApp.waitDefault();
    });

    test('Verify all issues resolved', async () => {
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitDefault();

      // When all issues are resolved, the filter button may not be visible
      // Just verify the issues count is 0
      const issueCountAfter = await vscodeApp.getIssuesCount();
      console.log(`Issues after all fixes: ${issueCountAfter}`);

      // Verify all issues are resolved
      expect(issueCountAfter).toBe(0);
      console.log(`All issues resolved: ${violationCountBefore} -> ${issueCountAfter}`);

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(screenshotDir, 'analysis-view-all-resolved.png'),
      });

      console.log('All violations fixed successfully');
    });

    // --- Cleanup Phase ---

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
  }
);
