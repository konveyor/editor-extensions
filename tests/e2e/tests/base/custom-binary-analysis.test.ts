import * as pathlib from 'path';
import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { generateRandomString } from '../../utilities/utils';
import fs from 'fs';
import { Configuration } from '../../pages/configuration.page';
import { KAIViews } from '../../enums/views.enum';
import { analyzerPath } from '../../enums/configuration-options.enum';
import * as VSCodeFactory from '../../utilities/vscode.factory';

/**
 * This test executes an analysis on the coolstore app using a custom analyzer binary.
 * It first tries to use the executable defined in the ANALYZER_BINARY_PATH environment variable.
 * If not present, it falls back to the analyzer from the collected assets (same as the one bundled with the extension, but still valid to verify functionality).
 * If neither option is available, the test throws an error.
 */
test.describe.serial(`@tier2 Override the analyzer binary and run analysis`, () => {
  let vscodeApp: VSCode;
  const randomString = generateRandomString();
  const profileName = `custom-binary-analysis-${randomString}`;
  let binaryPath: string | undefined;
  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(900000);
    const kaiFolderPath = pathlib.join(__dirname, '../../../../downloaded_assets/kai');
    if (!process.env.ANALYZER_BINARY_PATH && !fs.existsSync(kaiFolderPath)) {
      throw new Error(
        `This test requires the "ANALYZER_BINARY_PATH" environment variable to be set or the "downloaded_assets/kai" folder to exist in the project root`
      );
    }

    binaryPath = process.env.ANALYZER_BINARY_PATH;
    if (!binaryPath || !fs.existsSync(binaryPath)) {
      console.log('ANALYZER_BINARY_PATH env variable not set, grabbing from downloaded_assets');
      const platform = process.platform;
      const arch = process.arch;

      let platformFolder: string;
      if (platform === 'win32') {
        platformFolder = 'win32-x64';
      } else if (platform === 'darwin') {
        platformFolder = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
      } else if (platform === 'linux') {
        platformFolder = arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
      } else {
        throw new Error(`Unsupported platform: ${platform} ${arch}`);
      }

      const executableName = platform === 'win32' ? 'kai-analyzer-rpc.exe' : 'kai-analyzer-rpc';
      binaryPath = pathlib.join(kaiFolderPath, platformFolder, executableName);

      if (!fs.existsSync(binaryPath)) {
        throw new Error(`Analyzer executable not found at: ${binaryPath}`);
      }
    }

    console.log(`Custom analyzer path found in ${binaryPath}`);
    const repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName);
    await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);
  });

  // TODO (abrugaro): This test is affected by https://github.com/konveyor/editor-extensions/issues/720, enable the test once the issue fixed
  test("Use a non-existing path and verify the server doesn't start", async () => {
    const configPage = await Configuration.open(vscodeApp);
    await configPage.setInputConfiguration(analyzerPath, 'nonExistingPath');
    await vscodeApp.openAnalysisView();
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    await analysisView.getByRole('button', { name: 'Start' }).click({ delay: 500 });
    await expect(
      vscodeApp.getWindow().getByText("Analyzer binary doesn't exist").first()
    ).toBeVisible();
  });

  test('Analyze coolstore app', async () => {
    test.setTimeout(600000);
    const configPage = await Configuration.open(vscodeApp);
    await configPage.setInputConfiguration(analyzerPath, binaryPath!);
    await vscodeApp.startServer();
    await vscodeApp.waitDefault();
    await vscodeApp.runAnalysis();
    await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
      timeout: 400000,
    });
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    const violations = analysisView.locator('.pf-v6-c-card__header-toggle');
    expect(await violations.count()).toBeGreaterThan(10);
  });

  test.afterAll(async () => {
    const configPage = await Configuration.open(vscodeApp);
    await configPage.setInputConfiguration(analyzerPath, '');
    await vscodeApp.deleteProfile(profileName);
    await vscodeApp.closeVSCode();
  });
});
