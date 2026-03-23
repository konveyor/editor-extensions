import { expect, test } from '../../fixtures/test-repo-fixture';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { Configuration } from '../../pages/configuration.page';
import {
  acceptOnSaveSettingKey,
  analyzeOnSaveSettingKey,
  excludedDiagnosticSourcesSettingKey,
} from '../../enums/configuration-options.enum';
import { TabManager } from '../../pages/tab-manager.page';
import { VSCode } from '../../pages/vscode.page';
import { ResolutionAction } from '../../enums/resolution-action.enum';
import { FixTypes } from '../../enums/fix-types.enum';
import { KAIViews } from '../../enums/views.enum';
import { generateRandomString } from '../../utilities/utils';
import {
  getDefaultProviderConfig,
  LLEMULATOR_PROVIDER,
} from '../../fixtures/provider-configs.fixture';
import { buildKaiResponse, loadLlemulatorResponses } from '../../utilities/llemulator.utils';

const FILES_NAMES = ['CatalogService.java', 'InventoryNotificationMDB.java'];

test.describe('Plugin Settings - Analyze on Save', { tag: ['@tier3', '@slow'] }, () => {
  let vscodeApp: VSCode;
  let tabManager: TabManager;
  const profileName = `plugins-settings-${generateRandomString()}`;

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(300000);

    if (getDefaultProviderConfig() === LLEMULATOR_PROVIDER) {
      await loadLlemulatorResponses({
        reset: true,
        responses: [
          {
            pattern: '.*CatalogService.*',
            response: buildKaiResponse({
              reasoning: 'LLEMULATOR RESPONSE',
              language: 'java',
              // Verifies #1309
              fileContent:
                'package com.redhat.coolstore.service;\n' +
                '\n' +
                'import java.util.List;\n' +
                'import java.util.logging.Logger;\n' +
                '\n' +
                'import javax.inject.Inject;\n' +
                '\n' +
                'import jakarta.persistence.criteria.CriteriaBuilder;\n' +
                'import jakarta.persistence.criteria.CriteriaQuery;\n' +
                'import jakarta.persistence.criteria.Root;\n' +
                '\n' +
                'import jakarta.ejb.Stateless;\n' +
                'import jakarta.persistence.EntityManager;\n' +
                '\n' +
                'import com.redhat.coolstore.model.*;\n' +
                '\n' +
                '@Stateless\n' +
                'public class CatalogService {\n' +
                '\n' +
                '    @Inject\n' +
                '    Logger log;\n' +
                '\n' +
                '    @Inject\n' +
                '    private EntityManager em;\n' +
                '\n' +
                '    public CatalogService() {\n' +
                '    }\n' +
                '\n' +
                '    public List<CatalogItemEntity> getCatalogItems() {\n' +
                '        CriteriaBuilder cb = em.getCriteriaBuilder();\n' +
                '        CriteriaQuery<CatalogItemEntity> criteria = cb.createQuery(CatalogItemEntity.class);\n' +
                '        Root<CatalogItemEntity> member = criteria.from(CatalogItemEntity.class);\n' +
                '        criteria.select(member);\n' +
                '        return em.createQuery(criteria).getResultList();\n' +
                '    }\n' +
                '\n' +
                '    public CatalogItemEntity getCatalogItemById(String itemId) {\n' +
                '        return em.find(CatalogItemEntity.class, itemId);\n' +
                '    }\n' +
                '\n' +
                '    public void updateInventoryItems(String itemId, int deducts) {\n' +
                '        InventoryEntity inventoryEntity = getCatalogItemById(itemId).getInventory();\n' +
                '        int currentQuantity = inventoryEntity.getQuantity();\n' +
                '        inventoryEntity.setQuantity(currentQuantity-deducts);\n' +
                '        em.merge(inventoryEntity);\n' +
                '    }\n' +
                '\n' +
                '}\n',
            }),
            times: -1,
          },
          {
            pattern: '.*',
            response: buildKaiResponse({
              reasoning: 'LLEMULATOR RESPONSE',
              language: 'java',
              fileContent: 'LLEMULATOR RESPONSE',
            }),
            times: -1,
          },
        ],
      });
    }

    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
    await vscodeApp.configureGenerativeAI(getDefaultProviderConfig().config);
    await vscodeApp.waitDefault();
    tabManager = new TabManager(vscodeApp);
  });

  test('Enable "Analyze on Save" setting', async () => {
    const configurationPage = await Configuration.open(vscodeApp);
    await configurationPage.setEnabledConfiguration(analyzeOnSaveSettingKey, true);
    await vscodeApp.startServer();

    await vscodeApp.openFile(FILES_NAMES[0], true);
    await tabManager.modifyTabFile(FILES_NAMES[0]);
    await tabManager.saveTabFile(FILES_NAMES[0]);
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitForAnalysisCompleted();
    await vscodeApp.setListKindAndSort('files', 'ascending');
    let files = (await vscodeApp.getListNames('files')) as string[];
    expect(files).toContain(FILES_NAMES[0]);

    await vscodeApp.openFile(FILES_NAMES[1], true);
    await tabManager.modifyTabFile(FILES_NAMES[1]);
    await tabManager.saveTabFile(FILES_NAMES[1]);
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
    await tabManager.saveTabFile(FILES_NAMES[0]);
    await vscodeApp.openAnalysisView();
    await expect(vscodeApp.isAnalysisRunning()).resolves.toBe(false);
  });

  test('Enable "Auto Accept on Save" setting', async () => {
    const configurationPage = await Configuration.open(vscodeApp);
    await configurationPage.setEnabledConfiguration(acceptOnSaveSettingKey, true);
    // Waiting is needed to prevent a config item from being unset when multiple items are updated quickly
    await vscodeApp.waitDefault();
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
    await vscodeApp.executeTerminalCommand(
      'git status --short',
      new RegExp(`M.*${FILES_NAMES[0].replace('.', '\\.')}`)
    );
  });

  test('Disable "Auto Accept on Save" setting', async () => {
    const configurationPage = await Configuration.open(vscodeApp);
    await configurationPage.setEnabledConfiguration(acceptOnSaveSettingKey, false);
    await vscodeApp.waitDefault();
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
    await vscodeApp.executeTerminalCommand(
      'git status --short',
      new RegExp(`M.*${FILES_NAMES[1].replace('.', '\\.')}`),
      false
    );
  });

  test('Exclude diagnostic sources in agent mode', async ({ testRepoData }) => {
    test.setTimeout(600000);
    const repoInfo = testRepoData['coolstore'];

    await vscodeApp.openWorkspaceSettingsAndWrite({
      [excludedDiagnosticSourcesSettingKey]: ['java', 'konveyor'],
    });
    await vscodeApp.closeVSCode();
    vscodeApp = await VSCodeFactory.open(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
    await vscodeApp.executeTerminalCommand('git checkout .');
    await vscodeApp.startServer();
    await vscodeApp.runAnalysis();
    let analysisView = await vscodeApp.getView(KAIViews.analysisView);
    let agentSwitch = analysisView.locator('input#agent-mode-switch');
    if (!(await agentSwitch.isChecked())) {
      await agentSwitch.click();
    }
    await vscodeApp.waitForAnalysisCompleted();

    await vscodeApp.searchViolation("JMS' Topic must be replaced with an Emitter");

    let fixButton = analysisView.locator('button#get-solution-button[data-scope="issue"]');
    await expect(fixButton).toBeVisible({ timeout: 30000 });
    await fixButton.click();
    console.log('Fix button clicked');

    let resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
    await expect(resolutionView.locator('.batch-review-title').first()).toBeVisible({
      timeout: 60_000,
    });

    let acceptButton = resolutionView.getByRole('button', { name: 'Accept' }).first();
    await expect(acceptButton).toBeVisible({ timeout: 30000 });
    await acceptButton.click();
    console.log('Accept button clicked');

    // Wait for the "I found more changes to address" prompt (additional info from LLM)
    let noButton = resolutionView.locator('button').filter({ hasText: 'No' });
    await expect(noButton).toBeVisible({ timeout: 60000 });
    console.log('Additional info prompt appeared');
    await noButton.click();
    console.log('Clicked NO on additional info prompt');

    // With excluded sources, agent should NOT show diagnostic tasks and say "Done"
    await expect(resolutionView.getByText('Done addressing all issues. Goodbye!')).toBeVisible({
      timeout: 30000,
    });

    // PART 2: Without excluded sources
    await vscodeApp.openWorkspaceSettingsAndWrite({
      [excludedDiagnosticSourcesSettingKey]: ['trunk'],
    });
    await vscodeApp.executeTerminalCommand('git checkout . && git clean -df');
    await vscodeApp.closeVSCode();
    vscodeApp = await VSCodeFactory.open(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);

    await vscodeApp.startServer();
    await vscodeApp.runAnalysis();
    analysisView = await vscodeApp.getView(KAIViews.analysisView);
    agentSwitch = analysisView.locator('input#agent-mode-switch');
    if (!(await agentSwitch.isChecked())) {
      await agentSwitch.click();
    }
    await vscodeApp.waitForAnalysisCompleted();

    await vscodeApp.searchViolation("JMS' Topic must be replaced with an Emitter");

    fixButton = analysisView.locator('button#get-solution-button[data-scope="issue"]');
    await expect(fixButton).toBeVisible({ timeout: 30000 });
    await fixButton.click();
    console.log('Fix button clicked (second run)');

    resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
    await expect(resolutionView.locator('.batch-review-title').first()).toBeVisible({
      timeout: 60_000,
    });

    acceptButton = resolutionView.getByRole('button', { name: 'Accept' }).first();
    await expect(acceptButton).toBeVisible({ timeout: 30000 });
    await acceptButton.click();
    console.log('Accept button clicked (second run)');

    noButton = resolutionView.locator('button').filter({ hasText: 'No' });
    await expect(noButton).toBeVisible({ timeout: 60000 });
    console.log('Additional info prompt appeared (second run)');
    await noButton.click();
    console.log('Clicked NO on additional info prompt (second run)');

    // Without excluded sources, agent should show diagnostic tasks message
    await expect(
      resolutionView.getByText(/It appears that my fixes caused following issues/i)
    ).toBeVisible({ timeout: 60000 });
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
