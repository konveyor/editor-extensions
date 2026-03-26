import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { DEFAULT_PROVIDER } from '../../fixtures/provider-configs.fixture';
import { generateRandomString } from '../../utilities/utils';
import * as VSCodeFactory from '../../utilities/vscode.factory';

test.describe.serial('Minimal core smoke flow', { tag: ['@tier0', '@smoke'] }, () => {
  let vscodeApp: VSCode;
  let repoInfo: RepoData[string];
  const profileName = `smoke-${generateRandomString()}`;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(600000);
    repoInfo = testRepoData['coolstore'];
    if (!repoInfo) {
      throw new Error("'coolstore' fixture is missing from test-repos.json");
    }
    vscodeApp = await VSCodeFactory.open(repoInfo.repoUrl, repoInfo.repoName);
    await vscodeApp.waitDefault();
  });

  test('GenAI configuration', async () => {
    await vscodeApp.configureGenerativeAI(DEFAULT_PROVIDER.config);
  });

  test('Create profile', async () => {
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
  });

  test('Start server', async () => {
    await vscodeApp.startServer();
  });

  test('Run analysis', async () => {
    test.setTimeout(300000);
    await vscodeApp.runAnalysis();
    await vscodeApp.waitForAnalysisCompleted();
  });

  test('Verify analysis returns results', async () => {
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitDefault();
    const issuesCount = await vscodeApp.getIssuesCount();
    expect(issuesCount).toBeGreaterThan(0);
  });

  test('Delete the profile', async () => {
    await vscodeApp.deleteProfile(profileName);
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
