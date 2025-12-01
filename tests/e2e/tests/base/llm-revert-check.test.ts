import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { MIN } from '../../utilities/consts';
import { getAvailableProviders } from '../../fixtures/provider-configs.fixture';
import { generateRandomString } from '../../utilities/utils';

import path from 'path';
import { getFileImports } from '../../utilities/file.utils';
import * as VSCodeFactory from '../../utilities/vscode.factory';
/**
 * Automates https://github.com/konveyor/kai/issues/798
 * Tests that fixes applied by the LLM do not unintentionally revert .
 *
 * - Runs migration analysis and applies two specific fixes.
 * - Captures and compares import statements before and after fixes.
 * - Ensures earlier fixes are not reverted by later ones.
 */
getAvailableProviders().forEach((provider) => {
  test.describe(`@tier1 LLM Revertion tests | ${provider.model}`, () => {
    let vscodeApp: VSCode;
    const profileName = `llm-reversion-${generateRandomString()}`;
    let repoInfo: RepoData[string];
    const memberFileUri = path.resolve(
      'jboss-eap-quickstarts-kitchensink/kitchensink/src/main/java/org/jboss/as/quickstarts/kitchensink/model/Member.java'
    );
    let beforeTestMemberFileImports: string[];
    let afterFirstFixMemberFileImports: string[];
    let afterSecondFixMemberFileImports: string[];

    test.beforeAll(async ({ testRepoData }) => {
      test.setTimeout(15 * MIN);
      repoInfo = testRepoData['jboss-eap-quickstarts'];
      vscodeApp = await VSCodeFactory.open(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
      await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
      await vscodeApp.configureGenerativeAI(provider.config);
      await vscodeApp.startServer();
    });

    test.beforeEach(async () => {
      const testName = test.info().title.replace(' ', '-');
      console.log(`Starting ${testName} at ${new Date()}`);
    });

    test('Analyze jboss-eap-quickstarts', async () => {
      test.setTimeout(30 * MIN);
      await vscodeApp.waitDefault();
      await vscodeApp.runAnalysis();
      await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
        timeout: 15 * MIN,
      });
    });

    test('Fix "The package javax has been replaced by jakarta"', async () => {
      test.setTimeout(15 * MIN);
      beforeTestMemberFileImports = getFileImports(memberFileUri);
      const violation = "The package 'javax' has been replaced by 'jakarta'";

      await vscodeApp.openAnalysisView();
      await vscodeApp.searchViolationAndAcceptAllSolutions(violation);
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitForSolutionConfirmation();

      afterFirstFixMemberFileImports = getFileImports(memberFileUri);
    });

    test('Fix "Implicit name determination for sequences and tables associated with identifier generation has changed"', async () => {
      test.setTimeout(15 * MIN);
      const violation =
        'Implicit name determination for sequences and tables associated with identifier generation has changed';

      await vscodeApp.openAnalysisView();
      await vscodeApp.searchViolationAndAcceptAllSolutions(violation);
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitForSolutionConfirmation();

      afterSecondFixMemberFileImports = getFileImports(memberFileUri);
    });

    test('Checking For Reverted Imports', async () => {
      //checks that imports removed by the first fix were not reintroduced by the second fix.
      const revertedImports = beforeTestMemberFileImports.filter(
        (line) =>
          !afterFirstFixMemberFileImports.includes(line) &&
          afterSecondFixMemberFileImports.includes(line)
      );
      expect(revertedImports).toHaveLength(0);
    });

    test.afterEach(async () => {
      const testName = test.info().title.replace(' ', '-');
      console.log(`Finished ${testName} at ${new Date()}`);
    });

    test.afterAll(async () => {
      await vscodeApp.closeVSCode();
    });
  });
});
