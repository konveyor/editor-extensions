import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { Configuration } from '../../pages/configuration.page';
import { ConfigurationOptions } from '../../enums/configuration-options.enum';
import { DEFAULT_PROVIDER } from '../../fixtures/provider-configs.fixture';
import { MCPClient } from '../../../mcp-client/mcp-client.model';
import { FixTypes } from '../../enums/fix-types.enum';
import { KAIViews } from '../../enums/views.enum';
import {
  BestHintResponse,
  SuccessRateResponse,
} from '../../../mcp-client/mcp-client-responses.model';

test.describe(`Solution server comprehensive change acceptance scenarios`, () => {
  let vsCode: VSCode;
  let mcpClient: MCPClient;
  let successRateBase: SuccessRateResponse;
  let bestHintBase: BestHintResponse;

  test.beforeAll(async ({ testRepoData }) => {
    const repoInfo = testRepoData['coolstore'];
    test.setTimeout(600000);
    mcpClient = await MCPClient.connect('http://localhost:8000');
    vsCode = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
    const config = await Configuration.open(vsCode);
    await config.setEnabledConfiguration(ConfigurationOptions.SolutionServerEnabled, true);
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

  test('Accept all changes with validation', async () => {
    await requestFixAndValidateChangeAcceptance(true, 'all');

    const bestHint = await mcpClient.getBestHint('eap8/eap7', 'javax-to-jakarta-import-00001');
    expect(bestHint.hint_id).not.toEqual(bestHintBase.hint_id);
    expect(bestHint.hint.toLowerCase()).toContain('javax');
  });

  test('Reject all changes with validation', async () => {
    await requestFixAndValidateChangeAcceptance(false, 'all');

    const bestHint = await mcpClient.getBestHint('eap8/eap7', 'javax-to-jakarta-import-00001');
    expect(bestHint.hint_id).toEqual(bestHintBase.hint_id);
  });

  test('Modify individual hunks before accepting changes', async () => {
    await requestFixAndValidateChangeAcceptance(true, 'selective');

    const bestHint = await mcpClient.getBestHint('eap8/eap7', 'javax-to-jakarta-import-00001');
    expect(bestHint.hint_id).not.toEqual(bestHintBase.hint_id);
    expect(bestHint.hint.toLowerCase()).toContain('javax');
  });

  test.afterAll(async () => {
    await vsCode.closeVSCode();
  });

  /**
   * Handles a solution fix request and validates the change acceptance behavior.
   *
   * This method performs the complete flow of requesting a fix for a specific violation,
   * handling different change acceptance scenarios (accept all, reject all, or selective changes),
   * and validates that the solution server correctly tracks the success rates.
   *
   * @param accept boolean - Whether to ultimately accept or reject the changes
   * @param mode string - The acceptance mode: 'all', 'selective'
   *
   * @description The method performs the following steps:
   * 1. Searches for and requests a fix for the javax.persistence import violation
   * 2. Waits for the resolution view to appear with changes
   * 3. For 'selective' mode: modifies individual hunks before accepting/rejecting
   * 4. For 'all' mode: directly accepts or rejects all changes
   * 5. Validates that pending and counted solutions are incremented appropriately
   * 6. Opens the analysis view and waits for solution confirmation to complete
   * 7. Validates that the success rates are updated correctly
   * 8. Asserts that the UI displays the correct success rate counts
   */
  async function requestFixAndValidateChangeAcceptance(accept: boolean, mode: 'all' | 'selective') {
    await vsCode.searchAndRequestFix(
      'Replace the `javax.persistence` import statement with `jakarta.persistence`',
      FixTypes.Incident
    );

    const resolutionView = await vsCode.getView(KAIViews.resolutionDetails);

    // Wait for the resolution view to load with changes
    await expect(
      resolutionView.locator('div.expanded-diff-content, div.hunk-selection-interface')
    ).toBeVisible({
      timeout: 15000,
    });

    if (mode === 'selective') {
      await handleSelectiveChanges(resolutionView, accept);
    }

    // Handle final acceptance/rejection
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

  /**
   * Handles selective modification of individual hunks/changes in the resolution view.
   *
   * This function simulates a user reviewing and selectively accepting/rejecting
   * individual changes (hunks) before making a final decision on the overall solution.
   *
   * @param resolutionView - The resolution view frame locator
   * @param finalAccept - Whether the final action will be to accept or reject overall
   */
  async function handleSelectiveChanges(resolutionView: any, finalAccept: boolean) {
    // Check if we have multiple hunks (hunk selection interface)
    const hunkSelectionInterface = resolutionView.locator('div.hunk-selection-interface');
    const hasMultipleHunks = await hunkSelectionInterface.isVisible();

    if (hasMultipleHunks) {
      // Get all hunk items
      const hunkItems = resolutionView.locator('div.hunk-item');
      const hunkCount = await hunkItems.count();

      if (hunkCount > 0) {
        // For demonstration purposes:
        // - Accept the first hunk
        // - Reject the second hunk (if it exists)
        // - Leave others as pending

        // Accept first hunk
        const firstHunkAcceptButton = hunkItems.nth(0).locator('button.hunk-accept');
        if (await firstHunkAcceptButton.isVisible()) {
          await firstHunkAcceptButton.click();

          // Verify the hunk state changed to accepted
          await expect(hunkItems.nth(0)).toHaveClass(/hunk-accepted/);
        }

        // Reject second hunk if it exists
        if (hunkCount > 1) {
          const secondHunkRejectButton = hunkItems.nth(1).locator('button.hunk-reject');
          if (await secondHunkRejectButton.isVisible()) {
            await secondHunkRejectButton.click();

            // Verify the hunk state changed to rejected
            await expect(hunkItems.nth(1)).toHaveClass(/hunk-rejected/);
          }
        }

        // Additional verification: Check that hunk status badges are updated
        const acceptedBadges = resolutionView.locator('span.hunk-accepted');
        const rejectedBadges = resolutionView.locator('span.hunk-rejected');

        await expect(acceptedBadges).toHaveCount(1);
        if (hunkCount > 1) {
          await expect(rejectedBadges).toHaveCount(1);
        }
      }

      // Test the bulk action buttons if they exist
      const acceptAllButton = resolutionView.locator('button', { hasText: 'Accept All' });
      const rejectAllButton = resolutionView.locator('button', { hasText: 'Reject All' });
      const resetAllButton = resolutionView.locator('button', { hasText: 'Reset All' });

      if (await acceptAllButton.isVisible()) {
        // Test reset functionality
        if (await resetAllButton.isVisible()) {
          await resetAllButton.click();

          // Verify all hunks are reset to pending state
          const pendingItems = resolutionView.locator('div.hunk-pending');
          await expect(pendingItems).toHaveCount(hunkCount);
        }

        // Re-apply some selective changes after reset
        if (hunkCount > 0) {
          // Accept first hunk again
          const firstHunkAcceptButton = hunkItems.nth(0).locator('button.hunk-accept');
          if (await firstHunkAcceptButton.isVisible()) {
            await firstHunkAcceptButton.click();
          }
        }
      }
    } else {
      // Single hunk scenario - just verify the change is displayed
      const singleHunkDisplay = resolutionView.locator('div.expanded-diff-content');
      await expect(singleHunkDisplay).toBeVisible();
    }
  }
});
