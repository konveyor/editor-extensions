import * as pathlib from 'path';
import { expect, test } from '../fixtures/test-repo-fixture';
import { VSCode } from '../pages/vscode.page';
import { VSCodeDesktop } from '../pages/vscode-desktop.page';
import { SCREENSHOTS_FOLDER } from '../utilities/consts';
import { getRepoName } from '../utilities/utils';
import { OPENAI_GPT4O_PROVIDER } from '../fixtures/provider-configs.fixture';
import { KAIViews } from '../enums/views.enum';
import * as VSCodeFactory from '../utilities/vscode.factory';
import { verifyAnalysisViewCleanState } from '../utilities/utils';

// NOTE: This is the list of providers that have cached data for the coolstore app
// Update this list when you create cache for a new provider, you probably don't need
// to create cache for all providers, as the purpose of this test is to only test UX
const providers = [OPENAI_GPT4O_PROVIDER];

// NOTE: profileName is hardcoded for cache consistency
const profileName = 'JavaEE to Quarkus';

providers.forEach((config) => {
  test.describe(`Coolstore app tests with agent mode enabled - offline (cached) | ${config.provider}/${config.model}`, () => {
    let vscodeApp: VSCode;
    test.beforeAll(async ({ testRepoData }: { testRepoData: any }, testInfo: any) => {
      test.setTimeout(1600000);
      const repoName = getRepoName(testInfo);
      const repoInfo = testRepoData[repoName];

      // prepareOffline=true extracts LLM cache and sets demoMode/cacheDir BEFORE VS Code launches
      // This ensures the extension can use cached healthcheck data during initial activation
      vscodeApp = await VSCodeFactory.init(
        repoInfo.repoUrl,
        repoInfo.repoName,
        undefined,
        true // prepareOffline
      );

      // Wait for extension initialization
      // Both redhat.java and konveyor-java extensions will activate automatically
      // via workspaceContains activation events (pom.xml, build.gradle, etc.)
      if (vscodeApp instanceof VSCodeDesktop) {
        await vscodeApp.waitForExtensionInitialization();
      }

      try {
        await vscodeApp.deleteProfile(profileName);
      } catch {
        console.log(`An existing profile probably doesn't exist, creating a new one`);
      }
      await vscodeApp.createProfile(repoInfo.sources, repoInfo.targets, profileName);

      await vscodeApp.configureGenerativeAI(config.config);
      await vscodeApp.startServer();
    });

    test.beforeEach(async () => {
      const testName = test.info().title.replace(' ', '-');
      console.log(`Starting ${testName} at ${new Date()}`);
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/before-${testName}-${config.model.replace(/[.:]/g, '-')}.png`,
      });
    });

    // this test uses cached data, and only ensures that the agent mode flow works
    test('Fix JMS Topic issue with agent mode enabled (offline)', async () => {
      test.setTimeout(3600000);
      // update java configuration to auto-reload
      await vscodeApp.openWorkspaceSettingsAndWrite({
        'java.configuration.updateBuildConfiguration': 'automatic',
      });
      // we need to run analysis before enabling agent mode
      await vscodeApp.waitDefault();
      await vscodeApp.runAnalysis();
      await expect(vscodeApp.getWindow().getByText('Analysis completed').first()).toBeVisible({
        timeout: 300000,
      });
      // enable agent mode
      const analysisView = await vscodeApp.getView(KAIViews.analysisView);
      const agentModeSwitch = analysisView.locator('input#agent-mode-switch');
      await agentModeSwitch.click();
      console.log('Agent mode enabled');
      // find the JMS issue to fix
      await vscodeApp.searchViolation('References to JavaEE/JakartaEE JMS elements');

      // Click the Get Solution button for the specific JMS violation group (scope="issue")
      // This targets just the JMS violations, not all workspace violations
      const fixButton = analysisView.locator('button#get-solution-button[data-scope="issue"]');
      await expect(fixButton).toBeVisible({ timeout: 30000 });
      await fixButton.click();
      console.log('Fix button clicked');
      const resolutionView = await vscodeApp.getView(KAIViews.resolutionDetails);
      await vscodeApp.waitDefault();
      await vscodeApp.getWindow().screenshot({
        path: pathlib.join(
          SCREENSHOTS_FOLDER,
          'agentic_flow_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `resolution-view-before-agent-flow.png`
        ),
      });
      let done = false;
      let maxIterations = process.env.CI ? 50 : 200; // just for safety against inf loops, increase when generating new cache if this is hit
      let lastYesButtonCount = 0;
      while (!done) {
        maxIterations -= 1;
        if (maxIterations <= 0) {
          throw new Error('Agent loop did not finish within given iterations, this is unexpected');
        }
        // if the loading indicator is no longer visible, we have reached the end
        if ((await resolutionView.getByText('Done addressing all issues. Goodbye!').count()) > 0) {
          console.log('All issues have been addressed.');
          done = true;
          break;
        }
        // either a Yes/No button or 'Accept all changes' button will be visible throughout the flow
        const yesButton = resolutionView.locator('button').filter({ hasText: 'Yes' });
        const acceptChangesLocator = resolutionView.getByRole('button', { name: 'Accept' }).first();
        const yesButtonCount = await yesButton.count();
        if (yesButtonCount > lastYesButtonCount) {
          lastYesButtonCount = yesButtonCount;
          await vscodeApp.waitDefault();
          await yesButton.last().click();
          console.log('Yes button clicked');
          await vscodeApp.getWindow().screenshot({
            path: pathlib.join(
              SCREENSHOTS_FOLDER,
              'agentic_flow_coolstore',
              `${config.model.replace(/[.:]/g, '-')}`,
              `${1000 - maxIterations}-yesNo.png`
            ),
          });
        } else if ((await acceptChangesLocator.count()) > 0) {
          await acceptChangesLocator.last().click();
          console.log('Accept all changes button clicked');
          await vscodeApp.getWindow().screenshot({
            path: pathlib.join(
              SCREENSHOTS_FOLDER,
              'agentic_flow_coolstore',
              `${config.model.replace(/[.:]/g, '-')}`,
              `${1000 - maxIterations}-tasks.png`
            ),
          });
        } else {
          await vscodeApp.getWindow().screenshot({
            path: pathlib.join(
              SCREENSHOTS_FOLDER,
              'agentic_flow_coolstore',
              `${config.model.replace(/[.:]/g, '-')}`,
              `resolution-view-waiting.png`
            ),
          });
          console.log(
            `Waiting for 3 seconds for next action to appear, ${maxIterations} iterations remaining`
          );
          await vscodeApp.getWindow().waitForTimeout(3000);
        }
      }

      // Verify the analysis view is in a clean, interactive state
      await verifyAnalysisViewCleanState(
        vscodeApp,
        pathlib.join(
          SCREENSHOTS_FOLDER,
          'agentic_flow_coolstore',
          `${config.model.replace(/[.:]/g, '-')}`,
          `analysis-view-final-state.png`
        ),
        'Agent flow'
      );
    });

    test.afterEach(async () => {
      const testName = test.info().title.replace(' ', '-');
      console.log(`Finished ${testName} at ${new Date()}`);
      await vscodeApp.getWindow().screenshot({
        path: `${SCREENSHOTS_FOLDER}/after-${testName}-${config.model.replace(/[.:]/g, '-')}.png`,
      });
    });

    test.afterAll(async () => {
      if (process.env.UPDATE_LLM_CACHE) {
        await vscodeApp.updateLLMCache();
      }
      await vscodeApp.closeVSCode();
    });
  });
});
