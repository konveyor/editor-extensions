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
import { ResolutionAction } from '../../enums/resolution-action.enum';

test.describe(
  `Solution server analysis validations`,
  { tag: ['@tier3', '@requires-minikube'] },
  () => {
    let vsCode: VSCode;
    let mcpClient: MCPClient;
    let successRateBase: SuccessRateResponse;
    let bestHintBase: BestHintResponse;

    test.beforeAll(async ({ testRepoData }) => {
      const repoInfo = testRepoData['coolstore'];
      test.setTimeout(600000);
      mcpClient = await MCPClient.connect('http://localhost:8000');
      vsCode = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName);
      const config = await Configuration.open(vsCode);
      await config.setEnabledConfiguration(solutionServerEnabled, true);
      await vsCode.executeQuickCommand('Konveyor: Restart Solution Server');
      await vsCode.createProfile(repoInfo.sources, repoInfo.targets);
      await vsCode.configureGenerativeAI(DEFAULT_PROVIDER.config);
      await vsCode.startServer();
      await vsCode.runAnalysis();
      await expect(vsCode.getWindow().getByText('Analysis completed').first()).toBeVisible({
        timeout: 300000,
      });
    });

    test.beforeEach(async () => {
      successRateBase = await mcpClient.getSuccessRate([
        {
          ruleset_name: 'eap8/eap7',
          violation_name: 'javax-to-jakarta-import-00001',
        },
      ]);
      bestHintBase = await mcpClient.getBestHint('eap8/eap7', 'javax-to-jakarta-import-00001');
    });

    test('Reject solution and assert success rate', async () => {
      await requestFixAndAssertSolution(false);
      const bestHint = await mcpClient.getBestHint('eap8/eap7', 'javax-to-jakarta-import-00001');
      expect(bestHint.hint_id).toEqual(bestHintBase.hint_id);
    });

    test('Accept solution and assert success rate', async () => {
      await requestFixAndAssertSolution(true);
      const bestHint = await mcpClient.getBestHint('eap8/eap7', 'javax-to-jakarta-import-00001');
      expect(bestHint.hint_id).not.toEqual(bestHintBase.hint_id);

      // The hint text is not deterministic, but it should always contain the word javax
      expect(bestHint.hint.toLowerCase()).toContain('javax');
    });

    test.afterAll(async () => {
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
      await vsCode.searchAndRequestAction(
        'Replace the `javax.persistence` import statement with `jakarta.persistence`',
        FixTypes.Incident,
        ResolutionAction.Accept
      );

      const resolutionView = await vsCode.getView(KAIViews.resolutionDetails);
      const actionButton = resolutionView.locator(
        `button[aria-label="${accept ? 'Accept' : 'Reject'} all changes"]`
      );
      await actionButton.waitFor();

      let successRate = await mcpClient.getSuccessRate([
        {
          ruleset_name: 'eap8/eap7',
          violation_name: 'javax-to-jakarta-import-00001',
        },
      ]);
      expect(successRate.pending_solutions).toBe(successRateBase.pending_solutions + 1);
      expect(successRate.counted_solutions).toBe(successRateBase.counted_solutions + 1);
      await actionButton.click();

      await vsCode.openAnalysisView();
      const analysisView = await vsCode.getView(KAIViews.analysisView);

      await expect(
        analysisView
          .getByRole('heading', { level: 2 })
          .filter({ hasText: 'Waiting for solution confirmation...' })
      ).not.toBeVisible({ timeout: 35000 });

      successRate = await mcpClient.getSuccessRate([
        {
          ruleset_name: 'eap8/eap7',
          violation_name: 'javax-to-jakarta-import-00001',
        },
      ]);
      expect(successRate.pending_solutions).toBe(successRateBase.pending_solutions);

      const key = accept ? 'accepted_solutions' : 'rejected_solutions';
      expect(successRate[key]).toBe(successRateBase[key] + 1);
      expect(successRate.counted_solutions).toBe(successRateBase.counted_solutions + 1);

      await expect(
        analysisView.locator(
          `#javax-to-jakarta-import-00001-${accept ? 'accepted' : 'rejected'}-solutions`
        )
      ).toContainText(`${successRate[key]} ${accept ? 'accepted' : 'rejected'}`);
    }
  }
);
