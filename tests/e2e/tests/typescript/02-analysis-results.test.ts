import * as pathlib from 'path';
import * as fs from 'fs';
import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import {
  getDefaultProviderConfig,
  LLEMULATOR_PROVIDER,
} from '../../fixtures/provider-configs.fixture';
import { generateRandomString } from '../../utilities/utils';
import { KAIViews } from '../../enums/views.enum';
import { SCREENSHOTS_FOLDER } from '../../utilities/consts';
import { loadLlemulatorResponses, buildKaiResponse } from '../../utilities/llemulator.utils';
import { FixTypes } from '../../enums/fix-types.enum';
import { ResolutionAction } from '../../enums/resolution-action.enum';

test.describe.serial('TypeScript Extension - Analysis & Kai Integration', { tag: '@tier2' }, () => {
  let vscodeApp: VSCode;
  const randomString = generateRandomString();
  const profileName = `ts-analysis-kai-${randomString}`;
  let repoInfo: RepoData[string];
  const screenshotDir = pathlib.join(SCREENSHOTS_FOLDER, 'typescript-analysis-kai');
  let violationCountBefore: number;
  const provider = getDefaultProviderConfig();

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(600_000);

    if (provider === LLEMULATOR_PROVIDER) {
      await loadLlemulatorResponses({
        reset: true,
        responses: [
          buildKaiResponse({
            reasoning:
              'Removed the deprecated theme prop from PageSidebar for PatternFly v5 compatibility.',
            language: 'typescript',
            fileContent: `import React from 'react';
import { PageSidebar } from '@patternfly/react-core';

export const Sidebar: React.FC = () => {
  return <PageSidebar />;
};`,
            additionalInfo:
              'The theme prop was removed in PatternFly v5. The sidebar now inherits theming from the Page component.',
          }),
        ],
      });
      console.log('Llemulator responses loaded for analysis-kai test');
    }

    repoInfo = testRepoData['static-report'];
    if (!repoInfo) {
      throw new Error("'static-report' fixture is missing from test-repos.json");
    }
    vscodeApp = await VSCodeFactory.init(repoInfo);
    console.log('Waiting for extensions to load...');
    await vscodeApp.getWindow().waitForTimeout(15000);
  });

  test.beforeEach(async () => {
    test.setTimeout(600_000);
    const testName = test.info().title.replace(/ /g, '-');
    console.log(`Starting ${testName} at ${new Date()}`);
    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, `before-${testName}.png`),
    });
  });

  // --- Setup ---

  test('Create profile with PatternFly rulesets', async () => {
    await vscodeApp.waitDefault();
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
    console.log(`Profile created: ${profileName}`);
  });

  test('Configure GenAI Provider', async () => {
    await vscodeApp.configureGenerativeAI(provider.config);
    console.log('GenAI provider configured');
  });

  test('Start server', async () => {
    await vscodeApp.startServer();
    console.log('Server started successfully');
  });

  // --- Analysis Execution ---

  test('Run analysis on static-report repo', async () => {
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
    console.log('Analysis completed successfully');
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

  test('Verify Get Solution button is visible', async () => {
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitDefault();

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
    console.log(`Incidents count from UI: ${incidentsCount}, expected: ${repoInfo.incidentsCount}`);

    // Verify incidents count matches the expected count from test-repos.json
    // TODO (abrugaro to check): Allow ±5 tolerance due to minor variations in analysis results across environments
    try {
      expect(Math.abs(incidentsCount - repoInfo.incidentsCount)).toBeLessThanOrEqual(5);
    } catch (error) {
      const allIssues = await vscodeApp.getAllIssues();
      const dumpPath = pathlib.join(screenshotDir, 'incidents-count-mismatch-dump.txt');
      fs.writeFileSync(dumpPath, JSON.stringify(allIssues, null, 2));
      console.log(`Error matching issues, issues dumped to ${dumpPath}`);
      throw error;
    }

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

    // Pick a specific issue from test-repos.json to verify (using one with stable count)
    const expectedIssue = repoInfo.issues.find(
      (issue) => issue.title === 'spacer should be replaced with gap'
    );
    expect(expectedIssue).toBeDefined();

    // Find this issue in the UI results
    const foundIssue = allIssues.find((issue) => issue.title === expectedIssue!.title);
    expect(foundIssue).toBeDefined();
    expect(foundIssue!.incidentsCount).toBe(expectedIssue!.incidentsCount);

    console.log(
      `Verified issue "${expectedIssue!.title}" has ${foundIssue!.incidentsCount} incidents (expected: ${expectedIssue!.incidentsCount})`
    );

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'specific-issue-verified.png'),
    });
  });

  // --- Kai Integration (Non-Agent Mode) ---

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

    let analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Count violations before fix
    const violations = analysisView.locator('[class*="pf-v"][class*="-c-card__header-toggle"]');
    violationCountBefore = await violations.count();
    console.log(`Violations before fix: ${violationCountBefore}`);

    await vscodeApp.searchAndRequestAction(
      'The theme prop has been removed from PageSidebar',
      FixTypes.Incident,
      ResolutionAction.Accept
    );
    await vscodeApp.openAnalysisView();
    analysisView = await vscodeApp.getView(KAIViews.analysisView);
    await vscodeApp.waitForAnalysisCompleted();
  });

  test('Return to analysis view and verify state', async () => {
    await vscodeApp.openAnalysisView();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Count violations after fix
    const violations = analysisView.locator('[class*="pf-v"][class*="-c-card__header-toggle"]');
    const violationCountAfter = await violations.count();
    console.log(`Violations after fix: ${violationCountAfter}`);

    // Verify violations decreased
    expect(violationCountAfter).toBeLessThan(violationCountBefore);
    console.log(`Violations reduced from ${violationCountBefore} to ${violationCountAfter}`);
    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'analysis-view-final-state.png'),
    });
  });

  test('Delete profile', async () => {
    if (process.env.WEB_ENV === '1') {
      await vscodeApp.getWindow().waitForTimeout(30_000);
    }
    await vscodeApp.deleteProfile(profileName);
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
