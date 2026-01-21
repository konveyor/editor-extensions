import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { getAvailableProviders } from '../../fixtures/provider-configs.fixture';
import { generateRandomString, parseLogEntries } from '../../utilities/utils';
import { FixTypes } from '../../enums/fix-types.enum';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { Configuration } from '../../pages/configuration.page';
import { logLevel } from '../../enums/configuration-options.enum';
import { LogLevel } from '../../enums/Log-level.enum';
import { OutputChannels } from '../../enums/output.enum';
import { ResolutionAction } from '../../enums/resolution-action.enum';
import { SCREENSHOTS_FOLDER } from '../../utilities/consts';

getAvailableProviders().forEach((provider) => {
  test.describe(`@tier0 Run analysis and fix one issue - ${provider.model}`, () => {
    let vscodeApp: VSCode;
    const profileName = `fix-single-issue-${generateRandomString()}`;

    test.beforeAll(async ({ testRepoData }) => {
      test.setTimeout(1200_000);
      const repoInfo = testRepoData['coolstore'];
      vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName);
      await vscodeApp.waitDefault();
      await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
      await vscodeApp.configureGenerativeAI(provider.config);
      await vscodeApp.startServer();
      await vscodeApp.waitDefault();
      // set log level to info
      const configPage = await Configuration.open(vscodeApp);
      await configPage.setDropdownConfiguration(logLevel, LogLevel.INFO);
      // open output view and clear it
      await vscodeApp.outputPanel.openOutputView(OutputChannels.CoreExtension);
      await vscodeApp.outputPanel.clearOutputChannel();
      await vscodeApp.outputPanel.closeOutputView();
      await vscodeApp.runAnalysis();
      await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
        timeout: 600000,
      });
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/analysis-finished-fix-one-issue.png`,
      });
    });

    test('Fix one issue', async () => {
      test.setTimeout(600000);
      await vscodeApp.openAnalysisView();
      await vscodeApp.searchAndRequestAction(
        'InventoryEntity',
        FixTypes.Incident,
        ResolutionAction.Accept
      );
      await expect(
        vscodeApp
          .getWindow()
          .locator('div.notification-list-item')
          .getByText('Running Analysis')
          .first()
      ).toBeVisible({
        timeout: 600000,
      });

      await expect(
        vscodeApp
          .getWindow()
          .locator('div.notification-list-item')
          .getByText('Analysis completed')
          .first()
      ).toBeVisible({
        timeout: 600000,
      });
      console.log('Analysis completed');
      await vscodeApp.waitDefault();
      const logOutput = await vscodeApp.outputPanel.getOutputChannelContent(
        OutputChannels.CoreExtension
      );
      const logEntries = parseLogEntries(logOutput);
      expect(logEntries.length).toBeGreaterThanOrEqual(1);

      const allowedLevels: LogLevel[] = [LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];

      for (const entry of logEntries) {
        expect(
          allowedLevels.includes(entry.level as LogLevel),
          `Log entry had level "${entry.level}", expected one of: ${allowedLevels.join(', ')}. Full entry: ${JSON.stringify(entry)}`
        ).toBeTruthy();
      }
      await vscodeApp.outputPanel.closeOutputView();
    });

    test.afterAll(async () => {
      await vscodeApp.deleteProfile(profileName);
      await vscodeApp.closeVSCode();
    });
  });
});
