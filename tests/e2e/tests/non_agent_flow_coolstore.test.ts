import * as pathlib from 'path';
import { expect, test } from '../fixtures/test-repo-fixture';
import { VSCode } from '../pages/vscode.page';
import { SCREENSHOTS_FOLDER } from '../utilities/consts';
import { getRepoName } from '../utilities/utils';
import { OPENAI_GPT4O_PROVIDER } from '../fixtures/provider-configs.fixture';
import { KAIViews } from '../enums/views.enum';
import { kaiCacheDir, kaiDemoMode } from '../enums/configuration-options.enum';
import { verifyAnalysisViewCleanState } from '../utilities/utils';
import * as VSCodeFactory from '../utilities/vscode.factory';

// NOTE: This is the list of providers that have cached data for the coolstore app
// Update this list when you create cache for a new provider, you probably don't need
// to create cache for all providers, as the purpose of this test is to only test UX
const providers = [OPENAI_GPT4O_PROVIDER];

// NOTE: profileName is hardcoded for cache consistency
const profileName = 'JavaEE to Quarkus';

providers.forEach((config) => {
  test.describe(`Coolstore app tests with agent mode disabled - offline (cached) | ${config.provider}/${config.model}`, () => {
    let vscodeApp: VSCode;
    test.beforeAll(async ({ testRepoData }: { testRepoData: any }, testInfo: any) => {
      test.setTimeout(1600000);
      const repoName = getRepoName(testInfo);
      const repoInfo = testRepoData[repoName];
      vscodeApp = await VSCodeFactory.open(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
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

    // this test uses cached data, and ensures that the non-agent mode flow works for specific JMS issue
    test('Fix JMS Topic issue with agent mode disabled (offline)', async () => {
      test.setTimeout(3600000);
      // set demoMode and update java configuration to auto-reload
      await vscodeApp.openWorkspaceSettingsAndWrite({
        [kaiCacheDir]: pathlib.join('.vscode', 'cache'),
        [kaiDemoMode]: true,
        'java.configuration.updateBuildConfiguration': 'automatic',
      });

      // run analysis first
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

      // find the JMS issue to fix
      await vscodeApp.searchViolation('References to JavaEE/JakartaEE JMS elements');

      // Click the Get Solution button for the specific JMS violation group (scope="issue")
      // This targets just the JMS violations, not all workspace violations
      const fixButton = analysisView.locator('button#get-solution-button[data-scope="issue"]');
      await expect(fixButton).toBeVisible({ timeout: 30000 });
      await fixButton.click();
      console.log('Fix button clicked');

      const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
      await vscodeApp.waitDefault();

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(
          SCREENSHOTS_FOLDER,
          'non_agentic_flow_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `resolution-view-before-non-agent-flow.png`
        ),
      });

      // In non-agent mode, we should expect to see solutions presented directly
      // without the interactive Yes/No flow. Look for "Accept all changes" button
      // or similar solution acceptance mechanisms

      // Wait for the solution to be generated and presented
      const acceptChangesLocator = resolutionView.locator(
        'button[aria-label="Accept all changes"]'
      );

      // Wait for either the accept changes button or some indication that solutions are ready
      let solutionReady = false;
      let maxWaitTime = 60; // 60 seconds max wait

      while (!solutionReady && maxWaitTime > 0) {
        const acceptButtonVisible = (await acceptChangesLocator.count()) > 0;
        const solutionText = (await resolutionView.getByText('Solution').count()) > 0;
        const codeChanges = (await resolutionView.locator('.monaco-editor').count()) > 0;

        if (acceptButtonVisible || solutionText || codeChanges) {
          solutionReady = true;
          console.log('Solution appears to be ready');
        } else {
          console.log(`Waiting for solution to be ready... ${maxWaitTime} seconds remaining`);
          await vscodeApp.getWindow().waitForTimeout(1000);
          maxWaitTime--;
        }
      }

      if (!solutionReady) {
        throw new Error('Solution was not ready within the expected time frame');
      }

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(
          SCREENSHOTS_FOLDER,
          'non_agentic_flow_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `solution-ready.png`
        ),
      });

      // If we have an accept changes button, click it
      if ((await acceptChangesLocator.count()) > 0) {
        await acceptChangesLocator.click();
        console.log('Accept all changes button clicked');

        await vscodeApp.getWindow().screenshot({
          path: pathlib.join(
            SCREENSHOTS_FOLDER,
            'non_agentic_flow_coolstore',
            `${config.model.replace(/[.:]/g, '-')}`,
            `changes-accepted.png`
          ),
        });
      }

      // Verify that the solution was applied
      // This might involve checking for success messages or verifying file changes
      await vscodeApp.waitDefault();

      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(
          SCREENSHOTS_FOLDER,
          'non_agentic_flow_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `final-state.png`
        ),
      });

      // Verify the analysis view is in a clean, interactive state
      await verifyAnalysisViewCleanState(
        vscodeApp,
        pathlib.join(
          SCREENSHOTS_FOLDER,
          'non_agentic_flow_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `analysis-view-final-state.png`
        ),
        'Non-agent flow'
      );

      console.log('Non-agent mode JMS issue fix completed');
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
