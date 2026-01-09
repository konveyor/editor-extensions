import { expect, test } from '../../fixtures/test-repo-fixture';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { Configuration } from '../../pages/configuration.page';
import { analyzeOnSaveSettingKey } from '../../enums/configuration-options.enum';
import { FileEditorPage } from '../../pages/file-editor.page';
import { VSCode } from '../../pages/vscode.page';

const FILES_NAMES = ['CatalogService.java', 'InventoryNotificationMDB.java'];

test.describe('Plugin Settings - Analyze on Save', () => {
  let vscodeApp: VSCode;
  let fileEditorPage: FileEditorPage;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(300000);
    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
    await vscodeApp.waitDefault();
    fileEditorPage = new FileEditorPage(vscodeApp);
  });

  test('Enable "Analyze on Save" setting', async () => {
    const configurationPage = await Configuration.open(vscodeApp);
    await configurationPage.setEnabledConfiguration(analyzeOnSaveSettingKey, true);
    await vscodeApp.startServer();

    await vscodeApp.openFile(FILES_NAMES[0], true);
    await fileEditorPage.saveFile(FILES_NAMES[0]);
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitForAnalysisCompleted();
    await vscodeApp.setListKindAndSort('files', 'ascending');
    let files = (await vscodeApp.getListNames('files')) as string[];
    expect(files).toContain(FILES_NAMES[0]);

    await vscodeApp.openFile(FILES_NAMES[1], true);
    await fileEditorPage.saveFile(FILES_NAMES[1]);
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitForAnalysisCompleted();
    await vscodeApp.setListKindAndSort('files', 'ascending');
    files = (await vscodeApp.getListNames('files')) as string[];
    expect(files).toEqual(expect.arrayContaining([FILES_NAMES[0], FILES_NAMES[1]]));
  });

  test('Disable "Analyze on Save" setting', async () => {
    const configurationPage = await Configuration.open(vscodeApp);
    await configurationPage.setEnabledConfiguration(analyzeOnSaveSettingKey, false);
    await vscodeApp.startServer();

    await vscodeApp.openFile(FILES_NAMES[0], true);
    await fileEditorPage.saveFile(FILES_NAMES[0]);
    await vscodeApp.openAnalysisView();
    await expect(vscodeApp.isAnalysisRunning()).resolves.toBe(false);
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
