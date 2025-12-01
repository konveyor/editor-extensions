import { test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { OutputChannel } from '../../enums/output.enum';

test.describe(`Open Panels Tests`, () => {
  let vscodeApp: VSCode;

  test.beforeAll(async ({ testRepoData }) => {
    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
  });

  test('Open Output Panel', async () => {
    await vscodeApp.outputPanel.openOutputView(OutputChannel.KonveyorExtensionForVSCode);
  });

});
