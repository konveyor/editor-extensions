import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { KAIViews } from '../../enums/views.enum';
import { extensionName } from '../../utilities/utils';
import { OPENAI_GPT4O_PROVIDER } from '../../fixtures/provider-configs.fixture';
import * as VSCodeFactory from '../../utilities/vscode.factory';

const SOLUTION_SERVER_URL = process.env.SOLUTION_SERVER_URL;
const SOLUTION_SERVER_REALM = process.env.SOLUTION_SERVER_REALM ?? 'tackle';
const SOLUTION_SERVER_USERNAME = process.env.SOLUTION_SERVER_USERNAME ?? 'admin';
const SOLUTION_SERVER_PASSWORD = process.env.SOLUTION_SERVER_PASSWORD ?? 'Dog8code';

if (!SOLUTION_SERVER_URL) {
  throw new Error('SOLUTION_SERVER_URL environment variable is required');
}

type SolutionServerConfig = {
  name: string;
  ssEnabled: boolean;
  authInIDE: boolean;
  insecure: boolean;
  realm?: string;
  shouldConnect: boolean;
};

const solutionServerConfigs: SolutionServerConfig[] = [
  {
    name: 'All enabled',
    ssEnabled: true,
    authInIDE: true,
    insecure: true,
    shouldConnect: true,
  },
  {
    name: 'Auth disabled in IDE but enabled in operator',
    ssEnabled: true,
    authInIDE: false,
    insecure: true,
    shouldConnect: false,
  },
  {
    name: 'Insecure disabled (Certificate verification skipped)',
    ssEnabled: true,
    authInIDE: true,
    insecure: false,
    shouldConnect: false,
  },
  {
    name: 'Empty Realm string',
    ssEnabled: true,
    authInIDE: true,
    insecure: true,
    realm: '',
    shouldConnect: false,
  },
];

const buildSettings = (config: SolutionServerConfig) => ({
  [`${extensionName}.solutionServer`]: {
    enabled: config.ssEnabled,
    url: SOLUTION_SERVER_URL,
    auth: {
      enabled: config.authInIDE,
      insecure: config.insecure,
      realm: config.realm ?? SOLUTION_SERVER_REALM,
    },
  },
});

test.describe(`Configure Solution Server settings`, () => {
  let vscodeApp: VSCode;
  let repoInfo: RepoData[string];

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(900000);
    repoInfo = testRepoData['coolstore'];
    vscodeApp = await VSCodeFactory.open(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
    await vscodeApp.configureGenerativeAI(OPENAI_GPT4O_PROVIDER.config);
    await vscodeApp.openWorkspaceSettingsAndWrite(buildSettings(solutionServerConfigs[0]));
    await vscodeApp.waitDefault();
    await vscodeApp.configureSolutionServerCredentials(
      SOLUTION_SERVER_USERNAME,
      SOLUTION_SERVER_PASSWORD
    );
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
        console.log(`✅ PASSED: ${scenario.name} — Solution Server connected successfully`);
      } else {
        await expect(
          analysisView.getByRole('heading', { name: 'Warning alert: Solution' })
        ).toBeVisible();
        console.log(`✅ PASSED: ${scenario.name} — Warning displayed as expected`);
      }
    }
  });
});
