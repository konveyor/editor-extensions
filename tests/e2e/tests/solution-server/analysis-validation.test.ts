import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { Configuration } from '../../pages/configuration.page';
import { solutionServerEnabled } from '../../enums/configuration-options.enum';
import { DEFAULT_PROVIDER } from '../../fixtures/provider-configs.fixture';
import { MCPClient } from '../../../mcp-client/mcp-client.model';
import { FixTypes } from '../../enums/fix-types.enum';
import { KAIViews } from '../../enums/views.enum';
import {
  BestHintResponse,
  SuccessRateResponse,
} from '../../../mcp-client/mcp-client-responses.model';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { AnalysisTab } from '../../enums/analysis-tabs.enum';
import { FilterMode } from '../../enums/filter-mode.enum';

test.describe(`Solution server analysis validations`, () => {
  let vsCode: VSCode;
  let mcpClient: MCPClient;
  let successRateBase: SuccessRateResponse;
  let bestHintBase: BestHintResponse;
  const issueToFix = 'Replace the Java EE version with the Jakarta equivalent';
  const ruleSetName = 'eap8/eap7';
  const violationName = 'javaee-to-jakarta-namespaces-00033';
  let config: Configuration;
  const MAX_ATTEMPTS = 15;

  test.beforeAll(async ({ testRepoData }) => {
    const repoInfo = testRepoData['coolstore'];
    vsCode = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName);
    await vsCode.executeQuickCommand('Konveyor: Restart Solution Server');
    await vsCode.createProfile(repoInfo.sources, repoInfo.targets);
    await vsCode.configureGenerativeAI(DEFAULT_PROVIDER.config);
    config = await Configuration.open(vsCode);
    await config.setEnabledConfiguration(solutionServerEnabled, true);
    mcpClient = await MCPClient.connect();
    await vsCode.startServer();
    await vsCode.runAnalysis();
    await expect(vsCode.getWindow().getByText('Analysis completed').first()).toBeVisible({
      timeout: 900000,
    });
  });

  test.describe('Success rate validation tests', () => {
    test.setTimeout(600000);
    test.beforeEach(async () => {
      successRateBase = await mcpClient.getSuccessRate([
        { ruleset_name: ruleSetName, violation_name: violationName },
      ]);
      bestHintBase = await mcpClient.getBestHint(ruleSetName, violationName);
    });

    test('Reject solution and assert success rate', async () => {
      await requestFixAndAssertSolution(false);
      const bestHint = await mcpClient.getBestHint(ruleSetName, violationName);
      expect(bestHint.hint_id).toEqual(bestHintBase.hint_id);
    });

    test('Accept solution and assert success rate', async () => {
      await requestFixAndAssertSolution(true);
      const bestHint = await mcpClient.getBestHint(ruleSetName, violationName);
      expect(bestHint.hint_id).not.toEqual(bestHintBase.hint_id);
      expect(bestHint.hint.toLowerCase()).toContain('persistence');
    });
  });

  test('Filter by "Has Success Rate" - files view', async () => {
    await filterAndAssertFilteration(AnalysisTab.files);
  });

  test('Filter by "Has Success Rate" - issues view', async () => {
    await filterAndAssertFilteration(AnalysisTab.issues);
  });

  test('Filter by "Has Success Rate" - all incidents view', async () => {
    const analysisView = await vsCode.getView(KAIViews.analysisView);
    await vsCode.sortIncidntAndApplyFilter(AnalysisTab.all, FilterMode.off);
    const listContainer = analysisView.locator('div.pf-v6-l-stack.pf-m-gutter').nth(2);
    const allCards = await listContainer.locator('div.pf-v6-c-card').all();
    const analysisCard = allCards.find(async (card) => {
      const text = await card.textContent();
      return text?.includes('Analysis Results');
    });
    const isExpanded = await analysisCard!.evaluate((el) => el.classList.contains('pf-m-expanded'));
    if (!isExpanded) {
      const toggleBtn = analysisCard!.locator('.pf-v6-c-card__header-toggle button');
      await toggleBtn.click();
    }
    const incidentsBeforeFilter = await vsCode.getSolutionsStatusFromIncidentsView();
    await vsCode.sortIncidntAndApplyFilter(AnalysisTab.all, FilterMode.on);
    const incidentsAfterFilter = await vsCode.getSolutionsStatusFromIncidentsView();
    expect(incidentsAfterFilter).toEqual(incidentsBeforeFilter);
  });

  test.afterAll(async () => {
    if (mcpClient) {
      mcpClient.dispose();
    }
    await vsCode.closeVSCode();
  });

  /**
   * Handles a solution fix request and validates the success rate tracking.
   *
   * This method performs the complete flow of requesting a fix for a specific violation,
   * either accepting or rejecting the proposed solution, and then validates that the
   * solution server correctly tracks the success rates and updates the UI accordingly.
   *
   * @param accept boolean - Whether to accept or reject the proposed solution
   *
   * @description The method performs the following steps:
   * 1. Searches for and requests a fix for the javax.persistence import violation
   * 2. Waits for the accept/reject button to appear in the resolution view
   * 3. Validates that pending and counted solutions are incremented
   * 4. Clicks the accept or reject button based on the parameter
   * 5. Opens the analysis view and waits for solution confirmation to complete
   * 6. Validates that the success rates are updated correctly (pending decremented, accepted/rejected incremented)
   * 7. Asserts that the UI displays the correct success rate counts
   */
  async function requestFixAndAssertSolution(accept: boolean) {
    await restartSolutionServer();
    await vsCode.searchAndRequestFix(issueToFix, FixTypes.Incident);

    const resolutionView = await vsCode.getView(KAIViews.resolutionDetails);
    const actionButton = resolutionView.locator(
      `button[aria-label="${accept ? 'Accept' : 'Reject'} all changes"]`
    );
    await actionButton.waitFor({ timeout: 180000 });

    let updatedSucessRate = await getUpdatedSuccessRate(
      (current, expected) => current !== expected
    );

    expect(updatedSucessRate.pending_solutions).toBe(successRateBase.pending_solutions + 1);
    expect(updatedSucessRate.counted_solutions).toBe(successRateBase.counted_solutions + 1);

    await vsCode.acceptOrRejectAllSolutions(accept);
    await vsCode.openAnalysisView();
    const analysisView = await vsCode.getView(KAIViews.analysisView);

    await expect(
      analysisView
        .getByRole('heading', { level: 2 })
        .filter({ hasText: 'Waiting for solution confirmation...' })
    ).not.toBeVisible({ timeout: 35000 });

    updatedSucessRate = await getUpdatedSuccessRate((current, expected) => current === expected);
    expect(updatedSucessRate.pending_solutions).toBe(successRateBase.pending_solutions);
    await expect(
      analysisView
        .getByRole('heading', { level: 2 })
        .filter({ hasText: 'Waiting for user action...' })
    ).not.toBeVisible({ timeout: 105000 });

    let successRate = await mcpClient.getSuccessRate([
      {
        ruleset_name: ruleSetName,
        violation_name: violationName,
      },
    ]);

    const key = accept ? 'accepted_solutions' : 'rejected_solutions';
    expect(successRate[key]).toBe(successRateBase[key] + 1);
    expect(successRate.counted_solutions).toBe(successRateBase.counted_solutions + 1);

    await expect(
      analysisView.locator(`#${violationName}-${accept ? 'accepted' : 'rejected'}-solutions`)
    ).toContainText(`${successRate[key]} ${accept ? 'accepted' : 'rejected'}`);
  }

  /**
   * Toggles the "Has Success Rate" filter for a given analysis tab
   * and verifies that filtering doesn't change the solutions map.
   */
  async function filterAndAssertFilteration(tabName: AnalysisTab) {
    await restartSolutionServer();
    await vsCode.sortIncidntAndApplyFilter(tabName, FilterMode.off);
    const listBeforeFilter = await vsCode.getSolutionsStatusFromCardsView();
    await vsCode.sortIncidntAndApplyFilter(tabName, FilterMode.on);
    const listAfterFilter = await vsCode.getSolutionsStatusFromCardsView();
    expect(listAfterFilter).toEqual(listBeforeFilter);
  }

  /**
   * Polls the solution server until the success rate reflects
   * the latest database state or the max attempt limit is reached.
   *
   * @param comparisonFunction - A predicate used to determine whether
   *   the current success rate matches the expected value.
   *   Allows flexible checks for both “before” and “after” update states.
   */
  async function getUpdatedSuccessRate(
    comparisonFunction: (current: number, expected: number) => boolean
  ) {
    let successRate = await mcpClient.getSuccessRate([
      {
        ruleset_name: ruleSetName,
        violation_name: violationName,
      },
    ]);

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (comparisonFunction(successRate.pending_solutions, successRateBase.pending_solutions)) {
        break;
      }
      await vsCode.waitDefault();
      try {
        successRate = await mcpClient.getSuccessRate([
          {
            ruleset_name: ruleSetName,
            violation_name: violationName,
          },
        ]);
      } catch (error) {
        console.error(`Failed to get success rate at iteration ${i}:`, error);
        throw error;
      }
    }
    return successRate;
  }

  async function restartSolutionServer(waitingTime = 30000) {
    await vsCode.getWindow().waitForTimeout(waitingTime);
    await config.setEnabledConfiguration(solutionServerEnabled, false);
    await config.setEnabledConfiguration(solutionServerEnabled, true);
    await vsCode.getWindow().waitForTimeout(waitingTime);
  }
});
