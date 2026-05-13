import * as pathlib from 'path';
import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { readFileSync } from 'fs';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { generateRandomString } from '../../utilities/utils';

// Load test repos data
const testReposPath = pathlib.join(__dirname, '../../fixtures/test-repos.json');
const testReposData: RepoData = JSON.parse(readFileSync(testReposPath, 'utf-8'));

test.describe('Run analysis for different repositories', { tag: ['@tier3'] }, () => {
  for (const repoKey of ['coolstore', 'inventory_management', 'ehr']) {
    const repoInfo = testReposData[repoKey];
    test(`Analyze ${repoKey} app`, async () => {
      test.setTimeout(900000);
      const profileName = `run-diff-${generateRandomString()}`;

      const vscodeApp = await VSCodeFactory.open(
        repoInfo.repoUrl,
        repoInfo.repoName,
        repoInfo.branch
      );

      try {
        await test.step('Check data is set', async () => {
          if (repoInfo.issuesCount === undefined) {
            throw new Error(
              `'issuesCount' should be set for ${repoInfo.repoName} in test-repos.json`
            );
          }
          if (repoInfo.incidentsCount === undefined) {
            throw new Error(
              `'incidentsCount' should be set for ${repoInfo.repoName} in test-repos.json`
            );
          }
        });

        await test.step('Set up and run analysis', async () => {
          await vscodeApp.createProfile(
            repoInfo.sources,
            repoInfo.targets,
            profileName,
            repoInfo.customRulesFolder
          );
          await vscodeApp.startServer();
          await vscodeApp.runAnalysis();
          await vscodeApp.waitForAnalysisCompleted();
        });

        await test.step('Verify issues and incidents counts', async () => {
          const issuesCount = await vscodeApp.getIssuesCount();
          const incidentsCount = await vscodeApp.getIncidentsCount();

          // Allow an error margin of +-5 issues/incidents
          expect(
            issuesCount <= repoInfo.issuesCount + 5 && issuesCount >= repoInfo.issuesCount - 5
          ).toBeTruthy();
          expect(
            incidentsCount <= repoInfo.incidentsCount + 5 &&
              incidentsCount >= repoInfo.incidentsCount - 5
          ).toBeTruthy();

          const foundIssues = await vscodeApp.getAllIssues();
          expect(foundIssues.length).toBe(issuesCount);
        });
      } finally {
        await vscodeApp.deleteProfile(profileName);
        await vscodeApp.closeVSCode();
      }
    });
  }
});
