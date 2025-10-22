import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { KAIViews } from '../../enums/views.enum';
import { extensionName } from '../../utilities/utils';
import { OPENAI_GPT4O_PROVIDER } from '../../fixtures/provider-configs.fixture';

type SolutionServerConfig = {
  name: string;
  ssEnabled: boolean;
  authInIDE: boolean;
  insecure: boolean;
  realm: string;
  shouldConnect: boolean;
  username?: string;
  password?: string;
};

const solutionServerConfigs: SolutionServerConfig[] = [
  {
    name: 'All enabled',
    ssEnabled: true,
    authInIDE: true,
    insecure: true,
    realm: 'mta',
    shouldConnect: true,
  },
  {
    name: 'Auth disabled in IDE but enabled in operator',
    ssEnabled: true,
    authInIDE: false,
    insecure: true,
    realm: 'mta',
    shouldConnect: false,
  },
  {
    name: 'Insecure disabled (Certificate verification skipped)',
    ssEnabled: true,
    authInIDE: true,
    insecure: false,
    realm: 'mta',
    shouldConnect: false,
  },
  {
    name: 'Realm missing',
    ssEnabled: true,
    authInIDE: true,
    insecure: true,
    realm: '',
    shouldConnect: false,
  },
  {
    name: 'Wrong username',
    ssEnabled: true,
    authInIDE: true,
    insecure: true,
    realm: 'mta',
    username: 'wronguser',
    password: 'Dog8code',
    shouldConnect: false,
  },
  {
    name: 'Wrong password',
    ssEnabled: true,
    authInIDE: true,
    insecure: true,
    realm: 'mta',
    username: 'admin',
    password: 'wrongpass',
    shouldConnect: false,
  },
];

const buildSettings = (config: SolutionServerConfig) => ({
  [`${extensionName}.solutionServer`]: {
    enabled: config.ssEnabled,
    url: process.env.solutionServerUrl,
    auth: {
      enabled: config.authInIDE,
      insecure: config.insecure,
      realm: config.realm,
      username: config.username ?? 'admin',
      password: config.password ?? 'Dog8code',
    },
  },
});

test.describe(`Configure Solution Server settings`, () => {
  let vscodeApp: VSCode;
  let repoInfo: RepoData[string];

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(900000);
    repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCode.open(repoInfo.repoUrl, repoInfo.repoName);
    await vscodeApp.configureGenerativeAI(OPENAI_GPT4O_PROVIDER.config);
    await vscodeApp.startServer();
  });

  test('Different solution server settings', async () => {
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    for (const scenario of solutionServerConfigs) {
      console.log(`🔧 Testing scenario: ${scenario.name}`);
      const settings = buildSettings(scenario);
      await vscodeApp.openWorkspaceSettingsAndWrite(settings);
      await vscodeApp.waitDefault();

      if (scenario.shouldConnect) {
        await expect(
          analysisView.getByRole('heading', { name: 'Warning alert: Solution' })
        ).not.toBeVisible();
      } else {
        await expect(
          analysisView.getByRole('heading', { name: 'Warning alert: Solution' })
        ).toBeVisible();
      }
    }
  });
});
