import * as pathlib from 'path';
import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { OPENAI_GPT4O_PROVIDER } from '../../fixtures/provider-configs.fixture';
import { readFileSync } from 'fs';
import * as VSCodeFactory from '../../utilities/vscode.factory';

// Load test repos data
const testReposPath = pathlib.join(__dirname, '../../fixtures/test-repos.json');
const testReposData: RepoData = JSON.parse(readFileSync(testReposPath, 'utf-8'));

// Single test suite for all repositories
test.describe('Run analysis for different repositories', () => {
  const entries = Object.entries(testReposData) as [keyof RepoData, RepoData[keyof RepoData]][];

  for (const [repoKey, repoInfo] of entries) {
    test(`Analyze ${String(repoKey)} app`, async ({}, testInfo) => {
      test.setTimeout(900000);
      const profileName = `${String(repoKey)} analysis`;

      // Ensure per-worker VS Code isolation inside the factory (user-data-dir/extensions-dir)
      const vscodeApp = await VSCodeFactory.open(repoInfo.repoUrl, repoInfo.repoName);

      try {
        await test.step('Configure Generative AI', async () => {
          await vscodeApp.configureGenerativeAI(OPENAI_GPT4O_PROVIDER.config);
          await vscodeApp.waitForGenAIConfigurationCompleted();
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
          expect(repoInfo.issuesCount).not.toBeUndefined();
          expect(repoInfo.incidentsCount).not.toBeUndefined();

          const issuesCount = await vscodeApp.getIssuesCount();
          const incidentsCount = await vscodeApp.getIncidentsCount();

          expect(issuesCount).toBe(repoInfo.issuesCount);
          expect(incidentsCount).toBe(repoInfo.incidentsCount);
        });
      } finally {
        try {
          await vscodeApp.deleteProfile(profileName);
        } catch (e) {
          testInfo.attach('cleanup-deleteProfile-error.txt', { body: String(e) });
        }
        await vscodeApp.closeVSCode();
      }
    });
  }
});
