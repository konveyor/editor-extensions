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

        await test.step('Start KAI server', async () => {
          await vscodeApp.startServer();
        });

        await test.step('Create profile', async () => {
          await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
        });

        await test.step('Run analysis', async () => {
          await vscodeApp.runAnalysis();
          await expect(vscodeApp.getWindow().getByText(/^Analysis completed$/)).toBeVisible({
            timeout: 400_000,
          });
        });

        await test.step('Verify findings exist', async () => {
          const count = await expect.poll(
            async () => {
              const items = await vscodeApp.getListNames('issues');
              return items.length;
            },
            { timeout: 60_000, intervals: [1000, 2000, 4000] }
          );
          expect(count).toBeGreaterThan(0);
        });
      } finally {
        // Cleanup should run even if a previous step failed
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
