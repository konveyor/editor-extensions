import { expect, test } from '../fixtures/test-repo-fixture';
import { VSCode } from '../pages/vscode.page';
import { SCREENSHOTS_FOLDER, TEST_OUTPUT_FOLDER } from '../utilities/consts';
import { getRepoName, generateRandomString } from '../utilities/utils';
import {
  getAvailableProviders,
  getDefaultProviderConfig,
  LLEMULATOR_PROVIDER,
} from '../fixtures/provider-configs.fixture';
import path from 'path';
import { runEvaluation } from '../../kai-evaluator/core';
import { prepareEvaluationData, saveOriginalAnalysisFile } from '../utilities/evaluation.utils';
import { isAWSConfigured } from '../../kai-evaluator/utils/s3.utils';
import * as VSCodeFactory from '../utilities/vscode.factory';
import { ResolutionAction } from '../enums/resolution-action.enum';
import { FixTypes } from '../enums/fix-types.enum';
import { buildKaiResponse, loadLlemulatorResponses } from '../utilities/llemulator.utils';

const providers = process.env.CI ? getAvailableProviders() : [getDefaultProviderConfig()];

providers.forEach((config) => {
  test.describe(`Coolstore app tests | ${config.model}`, { tag: ['@tier3'] }, () => {
    let vscodeApp: VSCode;
    let allOk = true;
    const randomString = generateRandomString();
    let profileName = '';

    test.beforeAll(async ({ testRepoData }, testInfo) => {
      test.setTimeout(3000000);

      if (config === LLEMULATOR_PROVIDER) {
        await loadLlemulatorResponses({
          reset: true,
          responses: [
            {
              pattern: '.*',
              response: buildKaiResponse({
                reasoning: 'LLEMULATOR RESPONSE',
                language: 'java',
                fileContent: 'LLEMULATOR RESPONSE',
              }),
              times: -1,
            },
          ],
        });
      }

      const repoName = getRepoName(testInfo);
      const repoInfo = testRepoData[repoName];
      profileName = `${repoInfo.repoName}-${randomString}`;
      vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName);
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
      await vscodeApp.waitForAnalysisCompleted();
      /*
       * There is a limit in the number of analysis and solution files that kai stores
       * This method ensures the original analysis is stored to be used later in the evaluation
       */
      await saveOriginalAnalysisFile();
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/analysis-finished.png`,
      });
    });

    test('Fix all issues', async () => {
      test.setTimeout(3600000);
      await vscodeApp.openAnalysisView();
      await vscodeApp.searchAndRequestAction(undefined, FixTypes.All, ResolutionAction.Accept);
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

    test.afterAll(async ({ testRepoData }, testInfo) => {
      await vscodeApp.closeVSCode();
      if (test.info().status !== test.info().expectedStatus) {
        allOk = false;
      }
      // Evaluation should be performed only if all tests under this suite passed
      if (allOk && process.env.CI && config !== LLEMULATOR_PROVIDER) {
        test.setTimeout(300_000);
        if (!isAWSConfigured()) {
          console.warn('Skipping evaluation: AWS credentials are not configured.');
          return;
        }

        const repoInfo = testRepoData[getRepoName(testInfo)];
        await prepareEvaluationData(config.model);
        await runEvaluation(
          path.join(TEST_OUTPUT_FOLDER, 'incidents-map.json'),
          TEST_OUTPUT_FOLDER,
          {
            model: config.model,
            sources: repoInfo.sources,
            targets: repoInfo.targets,
          },
          `${TEST_OUTPUT_FOLDER}/coolstore-${config.model.replace(/[.:]/g, '-')}`
        );
      }
    });
  });
});
