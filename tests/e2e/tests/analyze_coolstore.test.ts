import * as pathlib from 'path';
import { expect, test } from '../fixtures/test-repo-fixture';
import { VSCode } from '../pages/vscode.pages';
import { SCREENSHOTS_FOLDER, TEST_OUTPUT_FOLDER } from '../utilities/consts';
import { getOSInfo, getRepoName, providerIdentifier } from '../utilities/utils';
import {
  DEFAULT_PROVIDER,
  OPENAI_GPT4O_PROVIDER,
  OPENAI_GPT4OMINI_PROVIDER,
  providerConfigs,
} from '../fixtures/provider-configs.fixture';
import path from 'path';
import { runEvaluation } from '../../kai-evaluator/core';
import { prepareEvaluationData, saveOriginalAnalysisFile } from '../utilities/evaluation.utils';
import { KAIViews } from '../enums/views.enum';

const providers = process.env.CI ? providerConfigs : [DEFAULT_PROVIDER];

providers.forEach((config) => {
  // NOTE: profileName is hardcoded for cache consistency
  const profileName = 'JavaEE to Quarkus';

  test.describe(`Coolstore app tests | ${config.model}`, () => {
    let vscodeApp: VSCode;
    let allOk = true;
    test.beforeAll(async ({ testRepoData }, testInfo) => {
      test.setTimeout(1600000);
      const repoName = getRepoName(testInfo);
      const repoInfo = testRepoData[repoName];
      vscodeApp = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
      try {
        await vscodeApp.deleteProfile(profileName);
      } catch {
        console.log(`An existing profile probably doesn't exist, creating a new one`);
      }
      await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
      await vscodeApp.configureGenerativeAI(config.config);
      await vscodeApp.startServer();
      await vscodeApp.ensureLLMCache();
    });

    test.beforeEach(async () => {
      const testName = test.info().title.replace(' ', '-');
      console.log(`Starting ${testName} at ${new Date()}`);
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/before-${testName}-${config.model.replace(/[.:]/g, '-')}.png`,
      });
    });

    test('Analyze coolstore app', async () => {
      test.setTimeout(3600000);
      await vscodeApp.waitDefault();
      await vscodeApp.runAnalysis();

      console.log(new Date().toLocaleTimeString(), 'Analysis started');
      await vscodeApp.waitDefault();
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/analysis-running.png`,
      });
      await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
        timeout: 300000,
      });
      /*
       * There is a limit in the number of analysis and solution files that kai stores
       * This method ensures the original analysis is stored to be used later in the evaluation
       */
      await saveOriginalAnalysisFile();
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/analysis-finished.png`,
      });
    });

    test('Fix Issue with default (Low) effort', async () => {
      test.setTimeout(3600000);
      await vscodeApp.openAnalysisView();
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      await vscodeApp.searchViolation('InventoryEntity');
      await analysisView.locator('div.pf-v6-c-card__header-toggle').nth(0).click();
      await analysisView.locator('button#get-solution-button').nth(3).click();
      const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
      const fixLocator = resolutionView.locator('button[aria-label="Accept all changes"]').first();
      await vscodeApp.waitDefault();
      await expect(fixLocator).toBeVisible({ timeout: 60000 });
      expect(await fixLocator.count()).toEqual(1);
      // Ensures the button is clicked even if there are notifications overlaying it due to screen size
      await fixLocator.dispatchEvent('click');
      await expect(
        resolutionView.getByText('All resolutions have been applied').first()
      ).toBeVisible({ timeout: 60000 });
    });

    test('Fix all issues with default (Low) effort', async () => {
      test.setTimeout(3600000);
      await vscodeApp.openAnalysisView();
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      await analysisView.locator('button#get-solution-button').first().click({ timeout: 300000 });
      const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
      const fixLocator = resolutionView.locator('button[aria-label="Accept all changes"]');
      await vscodeApp.waitDefault();
      await expect(fixLocator.first()).toBeVisible({ timeout: 3600000 });
      const fixesNumber = await fixLocator.count();
      let fixesCounter = await fixLocator.count();
      for (let i = 0; i < fixesNumber; i++) {
        await expect(fixLocator.first()).toBeVisible({ timeout: 30000 });
        // Ensures the button is clicked even if there are notifications overlaying it due to screen size
        await fixLocator.first().dispatchEvent('click');
        await vscodeApp.waitDefault();
        expect(await fixLocator.count()).toEqual(--fixesCounter);
      }
    });

    // this test uses cached data, and only ensures that the agent mode flow works
    test('Fix JMS Topic issue with agent mode enabled (offline)', async () => {
      // NOTE: update this list when you create cache for a new provider
      const cacheAvailableFor = [
        providerIdentifier(OPENAI_GPT4O_PROVIDER),
        providerIdentifier(OPENAI_GPT4OMINI_PROVIDER),
      ];
      // only run this test when either one is true:
      // 1. we are creating new cache
      // 2. we have cache checked-in for this provider
      test.skip(
        !(process.env.UPDATE_LLM_CACHE || cacheAvailableFor.includes(providerIdentifier(config))),
        `Skipping as either cache is not available for provider ${config.provider} or UPDATE_LLM_CACHE is not set`
      );

      test.setTimeout(3600000);
      // set demoMode and update java configuration to auto-reload
      await vscodeApp.writeOrUpdateVSCodeSettings({
        'konveyor.kai.cacheDir': pathlib.join('.vscode', 'cache'),
        'konveyor.kai.demoMode': true,
        'java.configuration.updateBuildConfiguration': 'automatic',
      });
      // we need to run analysis before enabling agent mode
      await vscodeApp.waitDefault();
      await vscodeApp.runAnalysis();
      await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
        timeout: 300000,
      });
      // enable agent mode
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      const agentModeSwitch = analysisView.locator('input#agent-mode-switch');
      await agentModeSwitch.click();
      // find the JMS issue to fix
      await vscodeApp.searchViolation('References to JavaEE/JakartaEE JMS elements');
      const fixButton = analysisView.locator('button#get-solution-button');
      await expect(fixButton.first()).toBeVisible({ timeout: 6000 });
      await fixButton.first().click();
      const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
      const loadingIndicator = resolutionView.locator('div.loading-indicator');
      await expect(loadingIndicator.first()).toBeVisible({ timeout: 6000 });
      let loadingIndicatorSeen = true;
      let maxIterations = 1000; // just for safety against inf loops
      while (loadingIndicatorSeen) {
        maxIterations -= 1;
        if (maxIterations <= 0) {
          throw new Error('Agent loop did not finish within 1000 iterations, this is unexpected');
        }
        // if the loading indicator is no longer visible, we have reached the end
        if ((await resolutionView.locator('div.loading-indicator').count()) === 0) {
          loadingIndicatorSeen = false;
          break;
        }
        // either a Yes/No button or 'Accept all changes' button will be visible throughout the flow
        const yesButton = resolutionView.locator('button').filter({ hasText: 'Yes' });
        const acceptChangesLocator = resolutionView.locator(
          'button[aria-label="Accept all changes"]'
        );
        const eitherButton = yesButton.or(acceptChangesLocator);
        await expect(eitherButton.last()).toBeVisible({ timeout: 40000 });
        await eitherButton.last().dispatchEvent('click');
      }
    });

    test.afterEach(async () => {
      if (test.info().status !== test.info().expectedStatus) {
        allOk = false;
      }
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
      // Evaluation should be performed just on Linux, on CI by default and only if all tests under this suite passed
      if (getOSInfo() === 'linux' && allOk && process.env.CI) {
        await prepareEvaluationData(config.model);
        await runEvaluation(
          path.join(TEST_OUTPUT_FOLDER, 'incidents-map.json'),
          TEST_OUTPUT_FOLDER,
          config.model,
          `${TEST_OUTPUT_FOLDER}/coolstore-${config.model.replace(/[.:]/g, '-')}`
        );
      }
    });
  });
});
