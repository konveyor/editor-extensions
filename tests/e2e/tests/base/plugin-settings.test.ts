import { expect, test } from '../../fixtures/test-repo-fixture';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { Configuration } from '../../pages/configuration.page';
import {
  acceptOnSaveSettingKey,
  analyzeOnSaveSettingKey,
} from '../../enums/configuration-options.enum';
import { TabManager } from '../../pages/tab-manager.page';
import { VSCode } from '../../pages/vscode.page';
import { ResolutionAction } from '../../enums/resolution-action.enum';
import { FixTypes } from '../../enums/fix-types.enum';

const FILES_NAMES = ['CatalogService.java', 'InventoryNotificationMDB.java'];

test.describe('Plugin Settings - Analyze on Save', () => {
  let vscodeApp: VSCode;
  let tabManager: TabManager;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(300000);
    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
    await vscodeApp.waitDefault();
    tabManager = new TabManager(vscodeApp);
  });

  test('Enable "Analyze on Save" setting', async () => {
    const configurationPage = await Configuration.open(vscodeApp);
    await configurationPage.setEnabledConfiguration(analyzeOnSaveSettingKey, true);
    await vscodeApp.startServer();

    await vscodeApp.openFile(FILES_NAMES[0], true);
    await tabManager.saveTabFile(FILES_NAMES[0]);
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitForAnalysisCompleted();
    await vscodeApp.setListKindAndSort('files', 'ascending');
    let files = (await vscodeApp.getListNames('files')) as string[];
    expect(files).toContain(FILES_NAMES[0]);

    await vscodeApp.openFile(FILES_NAMES[1], true);
    await tabManager.saveTabFile(FILES_NAMES[1]);
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitForAnalysisCompleted();
    await vscodeApp.setListKindAndSort('files', 'ascending');
    files = (await vscodeApp.getListNames('files')) as string[];
    await expect(files).toEqual(expect.arrayContaining([FILES_NAMES[0], FILES_NAMES[1]]));
  });

  test('Disable "Analyze on Save" setting', async () => {
    const configurationPage = await Configuration.open(vscodeApp);
    await configurationPage.setEnabledConfiguration(analyzeOnSaveSettingKey, false);
    await vscodeApp.startServer();

    await vscodeApp.openFile(FILES_NAMES[0], true);
    await tabManager.saveTabFile(FILES_NAMES[0]);
    await vscodeApp.openAnalysisView();
    await expect(vscodeApp.isAnalysisRunning()).resolves.toBe(false);
  });

  test('Enable "Auto Accept on Save" setting', async () => {
    const configurationPage = await Configuration.open(vscodeApp);
    await configurationPage.setEnabledConfiguration(acceptOnSaveSettingKey, true);
    await configurationPage.setEnabledConfiguration(analyzeOnSaveSettingKey, false);
    await vscodeApp.startServer();

    await vscodeApp.runAnalysis();
    await vscodeApp.waitForAnalysisCompleted();

    await vscodeApp.setListKindAndSort('files', 'ascending');
    await vscodeApp.searchAndRequestAction(
      FILES_NAMES[0],
      FixTypes.IncidentGroup,
      ResolutionAction.ReviewInEditor
    );
    await tabManager.saveTabFile(FILES_NAMES[0]);
    await vscodeApp.waitForFileSolutionAccepted(FILES_NAMES[0]);
    await tabManager.closeTabByName(FILES_NAMES[0]);
    await vscodeApp.executeTerminalCommand('git status --short', FILES_NAMES[0]);
  });

  test('Disable "Auto Accept on Save" setting', async () => {
    const configurationPage = await Configuration.open(vscodeApp);
    await configurationPage.setEnabledConfiguration(acceptOnSaveSettingKey, false);
    await configurationPage.setEnabledConfiguration(analyzeOnSaveSettingKey, false);
    await vscodeApp.startServer();

    await vscodeApp.runAnalysis();
    await vscodeApp.waitForAnalysisCompleted();

    await vscodeApp.setListKindAndSort('files', 'ascending');
    await vscodeApp.searchAndRequestAction(
      FILES_NAMES[1],
      FixTypes.IncidentGroup,
      ResolutionAction.ReviewInEditor
    );
    await tabManager.saveTabFile(FILES_NAMES[1]);
    await tabManager.closeTabByName(FILES_NAMES[1]);
    await vscodeApp.executeTerminalCommand('git status --short', FILES_NAMES[0], false);
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
