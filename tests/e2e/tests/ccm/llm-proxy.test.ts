import { expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import { HubConfigurationPage } from '../../pages/hub-configuration.page';
import { generateRandomString, getHubConfig } from '../../utilities/utils';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { KAIViews } from '../../enums/views.enum';
import { FixTypes } from '../../enums/fix-types.enum';
import {
  isLlemulatorConfigured,
  loadLlemulatorResponses,
  buildKaiResponse,
} from '../../utilities/llemulator.utils';

// Invalid GenAI provider config to trigger connection error
const INVALID_GENAI_CONFIG = `---
models:
  InvalidProvider: &active
    provider: "ChatOpenAI"
    args:
      model: "gpt-4o-mini"
      configuration:
        baseURL: "invalid"
active: *active
`;

/**
 * This test requires llemulator to be accessible from both within and outside the cluster,
 * so the LLM proxy can reach it and the test can load responses.
 */
test.describe.serial(
  'LLM Proxy Tests',
  {
    tag: ['@requires-minikube', '@tier2'],
  },
  () => {
    test.skip(!process.env.TEST_HUB_URL, 'LLM proxy tests require TEST_HUB_URL to be set');
    test.skip(!isLlemulatorConfigured(), 'LLM proxy tests require TEST_LLEMULATOR_URL to be set');
    test.setTimeout(600000);

    let vscodeApp: VSCode;
    const profileName = `llm-proxy-${generateRandomString()}`;

    test.beforeAll(async ({ testRepoData }) => {
      // Configure llemulator responses if available
      if (isLlemulatorConfigured()) {
        console.log('Configuring llemulator responses...');
        await loadLlemulatorResponses({
          reset: true,
          responses: [
            buildKaiResponse({
              reasoning: 'LLEMULATOR RESPONSE - This is a test response from llemulator',
              language: 'java',
              fileContent: '// Modified by llemulator for testing',
            }),
          ],
        });
        console.log('Llemulator responses configured successfully');
      }

      const repoInfo = testRepoData['coolstore'];
      vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);
      await vscodeApp.createProfile([], repoInfo.targets, profileName);
      await vscodeApp.configureGenerativeAI(INVALID_GENAI_CONFIG);
      await vscodeApp.openAnalysisView();
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);

      // Verify that the error alert is shown for failed provider connection
      await expect(
        analysisView.getByText('Failed to establish connection to the model')
      ).toBeVisible({ timeout: 30000 });
    });

    test.beforeEach(async function () {
      test.setTimeout(300_000);
      const testName = test.info().title.replace(/[_"'\s]/g, '');
      console.log(`Starting ${testName} at ${new Date()}`);
    });

    test('Hub LLM proxy configuration and notifications', async () => {
      console.log('Configuring Hub connection with profile sync enabled...');
      const authEnabled = !!(process.env.TEST_HUB_USERNAME && process.env.TEST_HUB_PASSWORD);
      const hubConfig = getHubConfig({
        url: process.env.TEST_HUB_URL,
        auth: {
          enabled: authEnabled,
          username: process.env.TEST_HUB_USERNAME ?? '',
          password: process.env.TEST_HUB_PASSWORD ?? '',
        },
        solutionServerEnabled: false,
        profileSyncEnabled: true,
      });

      const hubConfigPage = await HubConfigurationPage.open(vscodeApp);
      await hubConfigPage.fillForm(hubConfig);
      await vscodeApp.assertNotification('Successfully connected to Hub profile sync');
      console.log('Connected to the Hub');

      await vscodeApp.openAnalysisView();
      await vscodeApp.executeQuickCommand(
        `${VSCode.COMMAND_CATEGORY}: Open the GenAI model provider configuration file`
      );
      await vscodeApp.assertNotification(
        'Local settings are not used when Hub LLM proxy is available.'
      );
      await vscodeApp.executeQuickCommand(
        `${VSCode.COMMAND_CATEGORY}: Open the default the GenAI model provider configuration file and backup the current file`
      );
      await vscodeApp.assertNotification(
        'Local settings are not used when Hub LLM proxy is available.'
      );
      console.log('Hub LLM proxy notifications verified successfully');
    });

    // Automates https://github.com/konveyor/editor-extensions/pull/1305
    test('Request solution returns llemulator response', async () => {
      console.log('Running analysis...');
      await vscodeApp.startServer();
      await vscodeApp.runAnalysis();
      await vscodeApp.waitForAnalysisCompleted();

      console.log('Requesting solution...');
      await vscodeApp.searchAndRequestAction('', FixTypes.Incident);

      console.log('Verifying llemulator response...');
      const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
      await expect(resolutionView.getByText('LLEMULATOR RESPONSE')).toBeVisible({ timeout: 60000 });
      console.log('Llemulator response verified successfully');
    });

    test.afterAll(async () => {
      if (!vscodeApp) {
        return;
      }
      const hubPage = await HubConfigurationPage.open(vscodeApp);
      await hubPage.fillForm({
        ...getHubConfig(),
        enabled: false,
      });
      await vscodeApp.closeVSCode();
    });
  }
);
