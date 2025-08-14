import { expect, test } from '../fixtures/test-repo-fixture';
import { VSCode } from '../pages/vscode.page';
import { SCREENSHOTS_FOLDER, TEST_OUTPUT_FOLDER } from '../utilities/consts';
import { getOSInfo, getRepoName, generateRandomString } from '../utilities/utils';
import { DEFAULT_PROVIDER, providerConfigs } from '../fixtures/provider-configs.fixture';
import path from 'path';
import { runEvaluation } from '../../kai-evaluator/core';
import { prepareEvaluationData, saveOriginalAnalysisFile } from '../utilities/evaluation.utils';
import { KAIViews } from '../enums/views.enum';

const providers = process.env.CI ? providerConfigs : [DEFAULT_PROVIDER];

providers.forEach((config) => {
  test.describe(`Coolstore app tests | ${config.model}`, () => {
    let vscodeApp: VSCode;
    let allOk = true;
    const randomString = generateRandomString();
    let profileName = '';
    test.beforeAll(async ({ testRepoData }, testInfo) => {
      test.setTimeout(1600000);
      const repoName = getRepoName(testInfo);
      const repoInfo = testRepoData[repoName];
      profileName = `${repoInfo.repoName}-${randomString}`;
      vscodeApp = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
      await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
      await vscodeApp.configureGenerativeAI(config.config);
      await vscodeApp.startServer();
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
