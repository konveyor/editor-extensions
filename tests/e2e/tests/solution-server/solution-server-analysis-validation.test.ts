import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { Configuration } from '../../pages/configuration.page';
import { ConfigurationOptions } from '../../enums/configuration-options.enum';
import { DEFAULT_PROVIDER } from '../../fixtures/provider-configs.fixture';

test.describe(`Solution server analysis validations`, () => {
  let vsCode: VSCode;

  test.beforeAll(async ({ testRepoData }) => {
    const repoInfo = testRepoData['coolstore'];
    test.setTimeout(600000);
    vsCode = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
    const config = await Configuration.open(vsCode);
    await config.setEnabledConfiguration(ConfigurationOptions.SolutionServerEnabled, true);
    await vsCode.executeQuickCommand('Konveyor: Restart Solution Server');
    await vsCode.createProfile(repoInfo.sources, repoInfo.targets);
    await vsCode.configureGenerativeAI(DEFAULT_PROVIDER.config);
    await vsCode.startServer();
    await vsCode.runAnalysis();
    await expect(vsCode.getWindow().getByText('Analysis completed').first()).toBeVisible({
      timeout: 300000,
    });
  });

  test('Create Profile and Set Sources and targets', async ({ testRepoData }) => {});

  test.afterAll(async () => {
    await vsCode.closeVSCode();
  });
});
