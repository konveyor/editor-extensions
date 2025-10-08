import { test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { generateRandomString } from '../../utilities/utils';
import * as VSCodeFactory from '../../utilities/vscode.factory';
test.describe('Devspaces poc', () => {
  const profileName = `automation-${generateRandomString()}`;
  let vscodeApp: VSCode;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(900000);
    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName);
  });

  test('Create Profile and Set Sources and targets', async ({ testRepoData }) => {
    await vscodeApp.waitDefault();
    const repoInfo = testRepoData['coolstore'];
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
  });
});
