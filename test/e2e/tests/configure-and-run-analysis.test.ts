import { expect, test } from '../fixtures/test-repo-fixture';
import { VSCode } from '../pages/vscode.pages';
import { OPENAI_PROVIDER } from '../fixtures/provider-configs.fixture';

test.describe(`Configure extension and run analysis`, () => {
  let vscodeApp: VSCode;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(600000);
    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
  });

  test('Create Profile and Set Sources and targets', async ({ testRepoData }) => {
    await vscodeApp.waitDefault();
    const repoInfo = testRepoData['coolstore'];
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets);
  });

  test('Configure GenAI Provider', async () => {
    await vscodeApp.configureGenerativeAI(OPENAI_PROVIDER.config);
  });

  test('Start server', async () => {
    await vscodeApp.startServer();
  });

  test('Analyze coolstore app', async () => {
    await vscodeApp.waitDefault();
    await vscodeApp.runAnalysis();
    await vscodeApp.waitDefault();
    await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
      timeout: 300000,
    });
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
