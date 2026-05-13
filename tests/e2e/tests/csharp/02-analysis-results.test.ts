import * as pathlib from 'path';
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

// Affected by https://github.com/konveyor/kai/issues/928
test.describe.serial('C# Extension - Analysis & Kai Integration', { tag: '@tier3' }, () => {
  let vscodeApp: VSCode;
  const randomString = generateRandomString();
  const profileName = `csharp-e2e-${randomString}`;
  let repoInfo: RepoData[string];
  const screenshotDir = pathlib.join(SCREENSHOTS_FOLDER, 'csharp-e2e-workflow');
  let violationCountBefore: number;
  let incidentsCountBefore: number;
  const provider = getDefaultProviderConfig();

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(1200000);

    if (provider === LLEMULATOR_PROVIDER) {
      await loadLlemulatorResponses({
        reset: true,
        responses: [
          buildKaiResponse({
            reasoning:
              'Removed all System.Data.Entity references and migrated to Microsoft.EntityFrameworkCore.',
            language: 'csharp',
            fileContent: `using Microsoft.EntityFrameworkCore;

namespace NerdDinner.Models
{
    public class NerdDinnerContext : DbContext
    {
        public NerdDinnerContext(DbContextOptions<NerdDinnerContext> options) : base(options) { }

        public DbSet<Dinner> Dinners { get; set; }
        public DbSet<RSVP> RSVPs { get; set; }
    }
}`,
            additionalInfo: 'No additional changes needed.',
          }),
        ],
      });
    }

    repoInfo = testRepoData['nerd-dinner'];
    if (!repoInfo) {
      throw new Error("'nerd-dinner' fixture is missing from test-repos.json");
    }
    vscodeApp = await VSCodeFactory.openForRepo(repoInfo);
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

  test('Create profile with migration rulesets', async () => {
    await vscodeApp.createProfile(
      repoInfo.sources,
      repoInfo.targets,
      profileName,
      repoInfo.customRulesFolder
    );
  });

  test('Configure GenAI Provider', async () => {
    await vscodeApp.configureGenerativeAI(provider.config);
  });

  test('Start server', async () => {
    await vscodeApp.startServer();
  });

  test('Run analysis on nerd-dinner repo', async () => {
    test.setTimeout(600000);
    await vscodeApp.runAnalysis();
    await vscodeApp.waitForAnalysisCompleted();
  });

  test('Verify analysis results are displayed', async () => {
    await vscodeApp.openAnalysisView();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    const pageComponent = analysisView.locator('[class*="pf-v"][class*="-c-page"]').first();
    await expect(pageComponent).toBeVisible({ timeout: 10000 });

    const drawer = analysisView.locator('[class*="pf-v"][class*="-c-drawer"]').first();
    await expect(drawer).toBeVisible({ timeout: 5000 });

    const toolbar = analysisView.locator('[class*="pf-v"][class*="-c-toolbar"]').first();
    await expect(toolbar).toBeVisible({ timeout: 10000 });

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'analysis-results-displayed.png'),
    });
  });

  test('Verify issues count matches expected', async () => {
    await vscodeApp.openAnalysisView();

    const issuesCount = await vscodeApp.getIssuesCount();
    console.log(`Issues count from UI: ${issuesCount}, expected: ${repoInfo.issuesCount}`);

    expect(issuesCount).toBe(repoInfo.issuesCount);

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'issues-count-verified.png'),
    });
  });

  test('Verify incidents count matches expected', async () => {
    await vscodeApp.openAnalysisView();

    const incidentsCount = await vscodeApp.getIncidentsCount();
    console.log(`Incidents count from UI: ${incidentsCount}, expected: ${repoInfo.incidentsCount}`);

    expect(incidentsCount).toBe(repoInfo.incidentsCount);

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'incidents-count-verified.png'),
    });
  });

  test('Request and accept solution for one incident', async () => {
    test.setTimeout(600000);
    await vscodeApp.openAnalysisView();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    const violations = analysisView.locator('[class*="pf-v"][class*="-c-card__header-toggle"]');
    violationCountBefore = await violations.count();
    console.log(`Violations before fix: ${violationCountBefore}`);
    incidentsCountBefore = await vscodeApp.getIncidentsCount();
    console.log(`Incidents before fix: ${incidentsCountBefore}`);

    await vscodeApp.searchAndRequestAction(
      'Review Entity Framework lazy loading configuration',
      FixTypes.Incident,
      ResolutionAction.Accept
    );
    await vscodeApp.waitForAnalysisCompleted();
  });

  test('Return to analysis view and verify state', async () => {
    await vscodeApp.openAnalysisView();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    const violations = analysisView.locator('[class*="pf-v"][class*="-c-card__header-toggle"]');
    const violationCountAfter = await violations.count();
    console.log(`Violations after fix: ${violationCountAfter}`);
    const incidentsCountAfter = await vscodeApp.getIncidentsCount();
    console.log(`Incidents after fix: ${incidentsCountAfter}`);
    expect(incidentsCountAfter).toBeLessThan(incidentsCountBefore);

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'analysis-view-final-state.png'),
    });
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
