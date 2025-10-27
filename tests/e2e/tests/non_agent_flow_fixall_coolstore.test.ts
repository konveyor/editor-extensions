/**
 * Fix All Button Workflow Test - Non-Agent Mode
 *
 * IMPORTANT LIMITATION:
 * This test uses cached LLM responses from single-issue tests (JMS violations only).
 * It does NOT actually fix all violations in the workspace due to limited cache coverage.
 *
 * What this test DOES verify:
 * ✅ "Fix All" button (data-scope="workspace") exists and is clickable
 * ✅ Workflow starts correctly when button is clicked
 * ✅ Solutions are presented for manual review (non-agent mode)
 * ✅ File acceptance workflow completes for cached violations
 * ✅ UI returns to clean state after workflow
 *
 * What this test DOES NOT verify:
 * ❌ All violations in workspace are fixed
 * ❌ Multiple violation types are handled
 * ❌ Complete end-to-end fix-all workflow
 *
 * To create full fix-all cache (expensive):
 *   UPDATE_LLM_CACHE=1 npm run test:e2e -- non_agent_flow_fixall_coolstore.test.ts
 */

import * as pathlib from 'path';
import { expect, test } from '../fixtures/test-repo-fixture';
import { VSCode } from '../pages/vscode.page';
import { SCREENSHOTS_FOLDER } from '../utilities/consts';
import { getRepoName } from '../utilities/utils';
import { OPENAI_GPT4O_PROVIDER } from '../fixtures/provider-configs.fixture';
import { KAIViews } from '../enums/views.enum';
import { kaiCacheDir, kaiDemoMode } from '../enums/configuration-options.enum';
import * as VSCodeFactory from '../utilities/vscode.factory';
import { verifyAnalysisViewCleanState } from '../utilities/utils';

// NOTE: This is the list of providers that have cached data for the coolstore app
const providers = [OPENAI_GPT4O_PROVIDER];

// NOTE: profileName is hardcoded for cache consistency
const profileName = 'JavaEE to Quarkus';

providers.forEach((config) => {
  test.describe(`Coolstore app "Fix All" tests with agent mode disabled - offline (cached) | ${config.provider}/${config.model}`, () => {
    let vscodeApp: VSCode;
    test.beforeAll(async ({ testRepoData }: { testRepoData: any }, testInfo: any) => {
      test.setTimeout(1600000);
      const repoName = getRepoName(testInfo);
      const repoInfo = testRepoData[repoName];
      vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName);
      try {
        await vscodeApp.deleteProfile(profileName);
      } catch {
        console.log(`An existing profile probably doesn't exist, creating a new one`);
      }
      await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
      await vscodeApp.configureGenerativeAI(config.config);
      await vscodeApp.startServer();
      await vscodeApp.ensureLLMCache(false);
    });

    test.beforeEach(async () => {
      const testName = test.info().title.replace(' ', '-');
      console.log(`Starting ${testName} at ${new Date()}`);
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/before-${testName}-${config.model.replace(/[.:]/g, '-')}.png`,
      });
    });

    // NOTE: This test uses cached data from single-issue tests (JMS only)
    // It verifies the "Fix All" button workflow starts correctly, but does not
    // actually fix all issues due to limited cache coverage
    test('Fix All button workflow with agent mode disabled (limited cache)', async () => {
      test.setTimeout(3600000); // 1 hour - only tests workflow start with available cache

      // set demoMode and update java configuration to auto-reload
      await vscodeApp.writeOrUpdateVSCodeSettings({
        [kaiCacheDir]: pathlib.join('.vscode', 'cache'),
        [kaiDemoMode]: true,
        'java.configuration.updateBuildConfiguration': 'automatic',
      });

      // Run analysis first
      await vscodeApp.waitDefault();
      await vscodeApp.runAnalysis();
      await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
        timeout: 300000,
      });

      // Ensure agent mode is disabled (it should be by default)
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      const agentModeSwitch = analysisView.locator('input#agent-mode-switch');

      // Check if agent mode is enabled and disable it if necessary
      if (await agentModeSwitch.isChecked()) {
        await agentModeSwitch.click();
        console.log('Agent mode disabled');
      } else {
        console.log('Agent mode already disabled');
      }

      await vscodeApp.waitDefault();

      // Click the "Fix All" button at the top (workspace scope)
      const fixAllButton = analysisView.locator(
        'button#get-solution-button[data-scope="workspace"]'
      );
      await expect(fixAllButton).toBeVisible({ timeout: 30000 });
      await fixAllButton.click();
      console.log('Fix All button clicked');

      const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
      await vscodeApp.waitDefault();

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(
          SCREENSHOTS_FOLDER,
          'non_agent_flow_fixall_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `resolution-view-before-non-agent-flow.png`
        ),
      });

      // In non-agent mode, we should see solutions presented directly
      // We'll accept changes as they appear
      let done = false;
      let maxIterations = process.env.CI ? 50 : 200; // Realistic for cached data coverage
      let acceptButtonClickCount = 0;
      let lastAcceptButtonCount = 0;

      while (!done) {
        maxIterations -= 1;
        if (maxIterations <= 0) {
          throw new Error('Non-agent flow did not finish within given iterations');
        }

        // Check if we've reached the end - look for completion indicators
        const doneMessage = await resolutionView
          .getByText('Done addressing all issues. Goodbye!')
          .count();
        const loadingIndicator = await resolutionView.locator('.loading-indicator').count();
        const acceptButtons = await resolutionView
          .locator('button[aria-label="Accept all changes"]')
          .count();

        if (
          doneMessage > 0 ||
          (loadingIndicator === 0 && acceptButtons === 0 && acceptButtonClickCount > 0)
        ) {
          console.log('All issues appear to have been addressed.');
          done = true;
          break;
        }

        // Look for accept changes buttons
        const acceptChangesLocator = resolutionView.locator(
          'button[aria-label="Accept all changes"]'
        );
        const currentAcceptButtonCount = await acceptChangesLocator.count();

        if (currentAcceptButtonCount > lastAcceptButtonCount) {
          // New accept button appeared
          lastAcceptButtonCount = currentAcceptButtonCount;
          acceptButtonClickCount++;

          await vscodeApp.waitDefault();
          await acceptChangesLocator.last().click();
          console.log(
            `Accept all changes button clicked (count: ${acceptButtonClickCount}, iteration ${1000 - maxIterations})`
          );

          await vscodeApp.getWindow().screenshot({
            path: pathlib.join(
              SCREENSHOTS_FOLDER,
              'non_agent_flow_fixall_coolstore',
              `${config.model.replace(/[.:]/g, '-')}`,
              `${String(1000 - maxIterations).padStart(4, '0')}-accept.png`
            ),
          });
        } else {
          // Wait for next solution to appear
          if ((1000 - maxIterations) % 10 === 0) {
            await vscodeApp.getWindow().screenshot({
              path: pathlib.join(
                SCREENSHOTS_FOLDER,
                'non_agent_flow_fixall_coolstore',
                `${config.model.replace(/[.:]/g, '-')}`,
                `${String(1000 - maxIterations).padStart(4, '0')}-waiting.png`
              ),
            });
          }

          console.log(
            `Waiting for next solution... (${maxIterations} iterations remaining, ${acceptButtonClickCount} files accepted so far)`
          );
          await vscodeApp.getWindow().waitForTimeout(2000);
        }
      }

      console.log(
        `Fix All workflow completed with available cache. Files accepted: ${acceptButtonClickCount} ` +
          `(Note: Only cached violations were processed)`
      );

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(
          SCREENSHOTS_FOLDER,
          'non_agent_flow_fixall_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `final-state.png`
        ),
      });

      // Verify the analysis view is in a clean, interactive state
      await verifyAnalysisViewCleanState(
        vscodeApp,
        pathlib.join(
          SCREENSHOTS_FOLDER,
          'non_agent_flow_fixall_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `analysis-view-final-state.png`
        ),
        'Non-agent flow (Fix All)'
      );

      console.log('Non-agent mode Fix All completed');
    });

    test.afterEach(async () => {
      const testName = test.info().title.replace(' ', '-');
      console.log(`Finished ${testName} at ${new Date()}`);
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/after-${testName}-${config.model.replace(/[.:]/g, '-')}.png`,
      });
    });

    test.afterAll(async () => {
      if (process.env.UPDATE_LLM_CACHE) {
        await vscodeApp.updateLLMCache();
      }
      await vscodeApp.closeVSCode();
    });
  });
});
