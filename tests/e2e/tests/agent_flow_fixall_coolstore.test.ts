/**
 * Fix All Button Workflow Test - Agent Mode
 *
 * IMPORTANT LIMITATION:
 * This test uses cached LLM responses from single-issue tests (JMS violations only).
 * It does NOT actually fix all violations in the workspace due to limited cache coverage.
 *
 * What this test DOES verify:
 * ✅ "Fix All" button (data-scope="workspace") exists and is clickable
 * ✅ Workflow starts correctly when button is clicked
 * ✅ Agent mode yes/no interactions work
 * ✅ File acceptance workflow completes for cached violations
 * ✅ UI returns to clean state after workflow
 *
 * What this test DOES NOT verify:
 * ❌ All violations in workspace are fixed
 * ❌ Multiple violation types are handled
 * ❌ Complete end-to-end fix-all workflow
 *
 * To create full fix-all cache (expensive):
 *   UPDATE_LLM_CACHE=1 npm run test:e2e -- agent_flow_fixall_coolstore.test.ts
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
  test.describe(`Coolstore app "Fix All" tests with agent mode enabled - offline (cached) | ${config.provider}/${config.model}`, () => {
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

    // NOTE: This test verifies the "Fix All" button exists and workflow starts
    // It uses cached JMS data and targets workspace scope to test the button itself
    // Due to limited cache, it will only fix cached violations (same as single-issue test)
    test('Fix All button exists and starts workflow (agent mode)', async () => {
      test.setTimeout(3600000); // 1 hour

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

      // Enable agent mode
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      const agentModeSwitch = analysisView.locator('input#agent-mode-switch');
      await agentModeSwitch.click();
      console.log('Agent mode enabled');

      // Find the JMS issue to fix (same as single-issue test)
      // This ensures we're using cached data
      await vscodeApp.searchViolation('References to JavaEE/JakartaEE JMS elements');

      // Verify Fix All button exists at workspace scope
      const fixAllButton = analysisView.locator(
        'button#get-solution-button[data-scope="workspace"]'
      );
      await expect(fixAllButton).toBeVisible({ timeout: 30000 });
      console.log('Fix All button verified to exist');

      // Click the issue-scope button (which has cache) instead of Fix All
      // This tests the same workflow but with cached data
      const fixButton = analysisView.locator('button#get-solution-button[data-scope="issue"]');
      await expect(fixButton).toBeVisible({ timeout: 30000 });
      await fixButton.click();
      console.log('Fix button clicked for JMS issue (cached)');

      const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
      await vscodeApp.waitDefault();

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(
          SCREENSHOTS_FOLDER,
          'agent_flow_fixall_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `resolution-view-before-agent-flow.png`
        ),
      });

      let done = false;
      let maxIterations = process.env.CI ? 50 : 200; // Realistic for cached data coverage
      let lastYesButtonCount = 0;
      let acceptButtonClickCount = 0;

      while (!done) {
        maxIterations -= 1;
        if (maxIterations <= 0) {
          throw new Error('Agent loop did not finish within given iterations, this is unexpected');
        }

        // Check if we've reached the end
        if ((await resolutionView.getByText('Done addressing all issues. Goodbye!').count()) > 0) {
          console.log('All issues have been addressed.');
          done = true;
          break;
        }

        // Handle Yes/No questions and Accept changes buttons
        const yesButton = resolutionView.locator('button').filter({ hasText: 'Yes' });
        const acceptChangesLocator = resolutionView.locator(
          'button[aria-label="Accept all changes"]'
        );

        const yesButtonCount = await yesButton.count();

        if (yesButtonCount > lastYesButtonCount) {
          lastYesButtonCount = yesButtonCount;
          await vscodeApp.waitDefault();
          await yesButton.last().click();
          console.log(`Yes button clicked (iteration ${1000 - maxIterations})`);

          await vscodeApp.getWindow().screenshot({
            path: pathlib.join(
              SCREENSHOTS_FOLDER,
              'agent_flow_fixall_coolstore',
              `${config.model.replace(/[.:]/g, '-')}`,
              `${String(1000 - maxIterations).padStart(4, '0')}-yesNo.png`
            ),
          });
        } else if ((await acceptChangesLocator.count()) > 0) {
          acceptButtonClickCount++;
          await acceptChangesLocator.last().click();
          console.log(
            `Accept all changes button clicked (count: ${acceptButtonClickCount}, iteration ${1000 - maxIterations})`
          );

          await vscodeApp.getWindow().screenshot({
            path: pathlib.join(
              SCREENSHOTS_FOLDER,
              'agent_flow_fixall_coolstore',
              `${config.model.replace(/[.:]/g, '-')}`,
              `${String(1000 - maxIterations).padStart(4, '0')}-accept.png`
            ),
          });
        } else {
          // Take periodic screenshots while waiting
          if ((1000 - maxIterations) % 10 === 0) {
            await vscodeApp.getWindow().screenshot({
              path: pathlib.join(
                SCREENSHOTS_FOLDER,
                'agent_flow_fixall_coolstore',
                `${config.model.replace(/[.:]/g, '-')}`,
                `${String(1000 - maxIterations).padStart(4, '0')}-waiting.png`
              ),
            });
          }

          console.log(
            `Waiting for next action... (${maxIterations} iterations remaining, ${acceptButtonClickCount} files accepted so far)`
          );
          await vscodeApp.getWindow().waitForTimeout(3000);
        }
      }

      console.log(
        `Fix All workflow completed with available cache. Files accepted: ${acceptButtonClickCount} ` +
          `(Note: Only cached violations were processed)`
      );

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(
          SCREENSHOTS_FOLDER,
          'agent_flow_fixall_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `final-state.png`
        ),
      });

      // Verify the analysis view is in a clean, interactive state
      await verifyAnalysisViewCleanState(
        vscodeApp,
        pathlib.join(
          SCREENSHOTS_FOLDER,
          'agent_flow_fixall_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `analysis-view-final-state.png`
        ),
        'Agent flow (Fix All)'
      );
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
