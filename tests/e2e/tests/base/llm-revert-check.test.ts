import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { MIN } from '../../utilities/consts';
import {
  getAvailableProviders,
  LLEMULATOR_PROVIDER,
} from '../../fixtures/provider-configs.fixture';
import { generateRandomString } from '../../utilities/utils';

import path from 'path';
import { getFileImports } from '../../utilities/file.utils';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { FixTypes } from '../../enums/fix-types.enum';
import { ResolutionAction } from '../../enums/resolution-action.enum';
import { loadLlemulatorResponses, buildKaiResponse } from '../../utilities/llemulator.utils';
/**
 * Automates https://github.com/konveyor/kai/issues/798
 * Tests that fixes applied by the LLM do not unintentionally revert .
 *
 * - Runs migration analysis and applies two specific fixes.
 * - Captures and compares import statements before and after fixes.
 * - Ensures earlier fixes are not reverted by later ones.
 */
getAvailableProviders().forEach((provider) => {
  test.describe(`LLM Revertion tests | ${provider.model}`, { tag: ['@tier3'] }, () => {
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

      if (provider === LLEMULATOR_PROVIDER) {
        await loadLlemulatorResponses({
          reset: true,
          responses: [
            {
              pattern: '(?i).*Member\\.java.*',
              response: buildKaiResponse({
                reasoning: 'Replaced javax with jakarta imports for Member.java.',
                language: 'java',
                fileContent:
                  'package org.jboss.as.quickstarts.kitchensink.model;\nimport jakarta.persistence.Entity;@SuppressWarnings("serial")\n@Entity\n@XmlRootElement\n@Table(uniqueConstraints = @UniqueConstraint(columnNames = "email"))\npublic class Member implements Serializable {\n\n    @Id\n    @GeneratedValue\n    private Long id;\n}',
              }),
              times: 1,
            },
            {
              pattern: '(?i).*Member\\.java.*',
              response: buildKaiResponse({
                reasoning: 'Different fix for member java for the second issue',
                language: 'java',
                fileContent:
                  'package org.jboss.as.quickstarts.kitchensink.model;\nimport jakarta.persistence.Entity;@SuppressWarnings("serial")\n@Entity\n@XmlRootElement\n@Table(uniqueConstraints = @UniqueConstraint(columnNames = "email"))\npublic class Member implements Serializable {\n\n    @Id\n    @GeneratedValue\n    private Long id;\n}// Another different fix',
              }),
              times: 1,
            },
            {
              pattern: '.*\\.java',
              response: buildKaiResponse({
                reasoning: 'Replaced javax with jakarta imports.',
                language: 'java',
                fileContent:
                  'package org.jboss.as.quickstarts.kitchensink.model;\nimport jakarta.persistence.Entity;',
              }),
              times: -1,
            },
          ],
        });
      }

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
      await vscodeApp.waitForAnalysisCompleted();
    });

    test('Fix "The package javax has been replaced by jakarta"', async () => {
      test.setTimeout(15 * MIN);
      beforeTestMemberFileImports = getFileImports(memberFileUri);
      const violation = "The package 'javax' has been replaced by 'jakarta'";

      await vscodeApp.openAnalysisView();
      await vscodeApp.searchAndRequestAction(violation, FixTypes.Issue, ResolutionAction.Accept);
      await vscodeApp.openAnalysisView();
      await vscodeApp.waitForSolutionConfirmation();

      afterFirstFixMemberFileImports = getFileImports(memberFileUri);
    });

    test('Fix "Implicit name determination for sequences and tables associated with identifier generation has changed"', async () => {
      test.setTimeout(15 * MIN);
      const violation =
        'Implicit name determination for sequences and tables associated with identifier generation has changed';

      await vscodeApp.openAnalysisView();
      await vscodeApp.searchAndRequestAction(violation, FixTypes.Issue, ResolutionAction.Accept);
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
