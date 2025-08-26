import { expect, test } from '../fixtures/test-repo-fixture';
import { VSCode } from '../pages/vscode.page';
import { SCREENSHOTS_FOLDER } from '../utilities/consts';
import { getRepoName, generateRandomString } from '../utilities/utils';
import { providerConfigs } from '../fixtures/provider-configs.fixture';
import path from 'path';
import { KAIViews } from '../enums/views.enum';
import { getFileImports } from '../utilities/file.utils';
/**
 * Automates https://github.com/konveyor/kai/issues/798
 Tests that fixes applied by the LLM do not unintentionally revert .
 *
 * - Runs migration analysis and applies two specific fixes.
 * - Captures and compares import statements before and after fixes.
 * - Ensures earlier fixes are not reverted by later ones.
 */
providerConfigs.forEach((config) => {
  test.describe(`LLM Revertion tests | ${config.model}`, () => {
    let vscodeApp: VSCode;
    const randomString = generateRandomString();
    let profileName = `llm-reversion-${randomString}`;

    const kitchenRepoPath = 'jboss-eap-quickstarts/kitchensink';
    const relativeMemberFileUri =
      '../../jboss-eap-quickstarts/kitchensink/src/main/java/org/jboss/as/quickstarts/kitchensink/model/Member.java';

    const memberFileUri = path.resolve(__dirname, relativeMemberFileUri);
    let beforeTestMemberFileImports: string[];
    let afterFirstFixMemberFileImports: string[];
    let afterSecondFixMemberFileImports: string[];

    test.beforeAll(async ({ testRepoData }, testInfo) => {
      test.setTimeout(3600000);
      const repoName = getRepoName(testInfo);
      const repoInfo = testRepoData[repoName];

      vscodeApp = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
      await vscodeApp.closeVSCode();
      // Only analyzing kitchensink to save time vs. full jboss repo
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
    });

    test('Fix "The package javax has been replaced by jakarta"  with default (Low) effort', async () => {
      test.setTimeout(3600000);
      beforeTestMemberFileImports = getFileImports(memberFileUri);
      const violation = "The package 'javax' has been replaced by 'jakarta'";

      await vscodeApp.openAnalysisView();
      await vscodeApp.SearchViolationAndacceptAllSolutions(violation);
      await vscodeApp.openAnalysisView();
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      await vscodeApp.waitForSolutionConfirmatuin(analysisView);

      afterFirstFixMemberFileImports = getFileImports(memberFileUri);
    });

    test('Fix "Implicit name determination for sequences and tables associated with identifier generation has changed"  with default (Low) effort', async () => {
      test.setTimeout(3600000);
      const violation =
        'Implicit name determination for sequences and tables associated with identifier generation has changed';

      await vscodeApp.openAnalysisView();
      await vscodeApp.SearchViolationAndacceptAllSolutions(violation);
      await vscodeApp.openAnalysisView();
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      await vscodeApp.waitForSolutionConfirmatuin(analysisView);

      afterSecondFixMemberFileImports = getFileImports(memberFileUri);
    });

    test('Checking For Reverted Imports', async () => {
      //checks that imports removed by the first fix were not reintroduced by the second fix.
      for (const importLine of beforeTestMemberFileImports) {
        if (
          !afterFirstFixMemberFileImports.includes(importLine) &&
          afterSecondFixMemberFileImports.includes(importLine)
        ) {
          expect(afterSecondFixMemberFileImports).not.toContain(importLine);
        }
      }
    });

    test.afterEach(async () => {
      const testName = test.info().title.replace(' ', '-');
      console.log(`Finished ${testName} at ${new Date()}`);
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/after-${testName}-${config.model.replace(/[.:]/g, '-')}.png`,
      });
    });

    test.afterAll(async () => {
      await vscodeApp.closeVSCode();
    });
  });
});
