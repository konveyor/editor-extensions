import { expect, test } from '../fixtures/test-repo-fixture';
import { VSCode } from '../pages/vscode.pages';
import { SCREENSHOTS_FOLDER, TEST_OUTPUT_FOLDER } from '../utilities/consts';
import { getOSInfo, getRepoName, generateRandomString } from '../utilities/utils';
import { providerConfigs } from '../fixtures/provider-configs.fixture';
import path from 'path';
import { runEvaluation } from '../../kai-evaluator/core';
import { prepareEvaluationData, saveOriginalAnalysisFile } from '../utilities/evaluation.utils';
import { KAIViews } from '../enums/views.enum';
import { getFileImports } from '../utilities/file.utils';

providerConfigs.forEach((config) => {
  test.describe(`LLM Revertion tests | ${config.model}`, () => {
    let vscodeApp: VSCode;
    let allOk = true;
    const randomString = generateRandomString();
    let profileName = `llm-revetion-${randomString}`;

    const kitchenRepoPath = 'jboss-eap-quickstarts/kitchensink';
    const relativeMemberFileUri =
      '../../jboss-eap-quickstarts/kitchensink/src/main/java/org/jboss/as/quickstarts/kitchensink/model/Member.java';
    const relativeKoveyorPath = '../../jboss-eap-quickstarts/kitchensink/.vscode/konveyor';

    const memberFileUri = path.resolve(__dirname, relativeMemberFileUri);
    const konveyorRepoPath = path.resolve(__dirname, relativeKoveyorPath);

    let beforeTestMemberFileImports: string[];
    let afterFirstFixMemberFileImports: string[];
    let afterSecondFixMemberFileImports: string[];

    test.beforeAll(async ({ testRepoData }, testInfo) => {
      test.setTimeout(3600000);
      const repoName = getRepoName(testInfo);
      const repoInfo = testRepoData[repoName];

      vscodeApp = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
      await vscodeApp.closeVSCode();
      //analyizing only kitchensink is less time consuming then the entire jboss repo
      vscodeApp = await VSCode.open(undefined, kitchenRepoPath, undefined);
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

    test('Analyze jboss-eap-quickstarts', async () => {
      test.setTimeout(3600000);
      await vscodeApp.waitDefault();
      await vscodeApp.runAnalysis();

      console.log(new Date().toLocaleTimeString(), 'Analysis started');
      await vscodeApp.waitDefault();
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/analysis-running.png`,
      });
      await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
        timeout: 3600000,
      });
      /* * There is a limit in the number of analysis and solution files that kai stores
       * This method ensures the original analysis is stored to be used later in the evaluation
       */
      await saveOriginalAnalysisFile(konveyorRepoPath);
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/analysis-finished.png`,
      });
    });

    test('Fix "The package javax has been replaced by jakarta"  with default (Low) effort', async () => {
      test.setTimeout(3600000);
      beforeTestMemberFileImports = getFileImports(memberFileUri);
      await vscodeApp.openAnalysisView();
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      await vscodeApp.searchViolation("The package 'javax' has been replaced by 'jakarta'");

      await analysisView
        .locator('button[aria-label="Get solution"]')
        .nth(1)
        .click({ timeout: 3600000 });
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

      await vscodeApp.openAnalysisView();
      // Ensure that the analysis view is the first iframe on Dom
      await vscodeApp.closeAllOtherEditors();
      await expect(analysisView.locator('button[aria-label="Get solution"]').first()).toBeVisible({
        timeout: 3600000,
      });

      afterFirstFixMemberFileImports = getFileImports(memberFileUri);
    });

    test('Fix "Implicit name determination for sequences and tables associated with identifier generation has changed"  with default (Low) effort', async () => {
      test.setTimeout(3600000);
      await vscodeApp.openAnalysisView();
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      await vscodeApp.searchViolation(
        'Implicit name determination for sequences and tables associated with identifier generation has changed'
      );
      await analysisView
        .locator('button[aria-label="Get solution"]')
        .nth(1)
        .click({ timeout: 30000 });

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

      await vscodeApp.openAnalysisView();
      // Ensure that the analysis view is the first iframe on Dom
      await vscodeApp.closeAllOtherEditors();
      await expect(analysisView.locator('button[aria-label="Get solution"]').first()).toBeVisible({
        timeout: 3600000,
      });

      afterSecondFixMemberFileImports = getFileImports(memberFileUri);
    });

    test('Checking For Reverted Imports', async () => {
      //checks that imports removed by the first fix were not reintroduced by the second fix.
      for (const importLine of beforeTestMemberFileImports) {
        if (
          !afterFirstFixMemberFileImports.includes(importLine) &&
          afterSecondFixMemberFileImports.includes(importLine)
        ) {
          throw new Error('LLM reverted the following import: ' + importLine);
        }
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
