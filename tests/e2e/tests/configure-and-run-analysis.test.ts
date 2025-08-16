import * as pathlib from 'path';
import * as fs from 'fs/promises';
import { expect, test } from '../fixtures/test-repo-fixture';
import { VSCode } from '../pages/vscode.page';
import { OPENAI_GPT4O_PROVIDER } from '../fixtures/provider-configs.fixture';
import { generateRandomString } from '../utilities/utils';

test.describe(`Configure extension and run analysis`, () => {
  let vscodeApp: VSCode;
  const randomString = generateRandomString();
  const profileName = `automation-${randomString}`;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(600000);
    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
  });

  test('Create Profile and Set Sources and targets', async ({ testRepoData }) => {
    await vscodeApp.waitDefault();
    const repoInfo = testRepoData['coolstore'];
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
  });

  test('Configure GenAI Provider', async () => {
    await vscodeApp.configureGenerativeAI(OPENAI_GPT4O_PROVIDER.config);
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

  test('Generate debug archive', async ({ testRepoData }) => {
    await vscodeApp.executeQuickCommand('Konveyor: Generate Debug Archive');
    await vscodeApp.waitDefault();
    const zipPathInput = vscodeApp
      .getWindow()
      .getByPlaceholder('Enter the path where the debug archive will be saved');
    expect(await zipPathInput.count()).toEqual(1);
    await zipPathInput.fill(pathlib.join('.vscode', 'debug-archive.zip'));
    await vscodeApp.getWindow().keyboard.press('Enter');
    await vscodeApp.waitDefault();
    const redactProviderConfigInput = vscodeApp
      .getWindow()
      .getByText(
        'Select provider settings values you would like to include in the archive, all other values will be redacted'
      );
    expect(await redactProviderConfigInput.count()).toEqual(1);
    await vscodeApp.getWindow().keyboard.press('Enter');
    await vscodeApp.waitDefault();
    const includeLLMTracesPrompt = vscodeApp.getWindow().getByText('Include LLM traces?');
    if ((await includeLLMTracesPrompt.count()) === 1) {
      await vscodeApp.getWindow().keyboard.press('Enter');
      await vscodeApp.waitDefault();
    }
    const zipStat = await fs.stat(
      pathlib.join(testRepoData['coolstore'].repoName, '.vscode', 'debug-archive.zip')
    );
    expect(zipStat.isFile()).toBe(true);
  });

  test('delete profile', async () => {
    await vscodeApp.deleteProfile(profileName);
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
