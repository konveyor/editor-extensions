import * as pathlib from 'path';
import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { readFileSync } from 'fs';
import * as VSCodeFactory from '../../utilities/vscode.factory';

// Load test repos data
const testReposPath = pathlib.join(__dirname, '../../fixtures/test-repos.json');
const testReposData: RepoData = JSON.parse(readFileSync(testReposPath, 'utf-8'));

test.describe('Run analysis for different repositories', { tag: ['@tier3'] }, () => {
  const entries = Object.entries(testReposData) as [keyof RepoData, RepoData[keyof RepoData]][];

  for (const [repoKey, repoInfo] of entries) {
    if (repoKey === 'jboss-eap-quickstarts') {
      continue;
    }
    test(`Analyze ${String(repoKey)} app`, async ({}, testInfo) => {
      test.setTimeout(900000);
      const profileName = `${String(repoKey)} analysis`;

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

        await test.step('Create profile', async () => {
          await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
        });

        await test.step('Start KAI server', async () => {
          await vscodeApp.startServer();
        });

        await test.step('Run analysis', async () => {
          await vscodeApp.runAnalysis();
          await vscodeApp.waitForAnalysisCompleted();
        });

        await test.step('Verify issues and incidents counts', async () => {
          const issuesCount = await vscodeApp.getIssuesCount();
          const incidentsCount = await vscodeApp.getIncidentsCount();

          expect(issuesCount).toBe(repoInfo.issuesCount);
          expect(incidentsCount).toBe(repoInfo.incidentsCount);

          const foundIssues = await vscodeApp.getAllIssues();

          expect(foundIssues.length).toBe(repoInfo.issues.length);
          expect(foundIssues).toEqual(repoInfo.issues);
        });
      } finally {
        try {
          await vscodeApp.deleteProfile(profileName);
        } catch (e) {
          testInfo.attach('cleanup-deleteProfile-error.txt', { body: String(e) });
          console.error('Error deleting profile:', e);
        }
        await vscodeApp.closeVSCode();
      }
    });
  }
});
