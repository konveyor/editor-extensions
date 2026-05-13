import { expect, test } from '../../fixtures/test-repo-fixture';
import type { VSCode } from '../../pages/vscode.page';
import { HubConfigurationPage } from '../../pages/hub-configuration.page';
import { KAIViews } from '../../enums/views.enum';
import * as VSCodeFactory from '../../utilities/vscode.factory';

test.describe(
  'Hub Configuration from Environment Variables',
  {
    tag: ['@tier3', '@experimental'],
  },
  () => {
    test.skip(!!process.env.WEB_ENV, `Env variables won't be overwritten in VSCode Web`);
    test.setTimeout(600000);

    test('Verify all features enabled via environment variables with forced hub', async ({
      testRepoData,
    }) => {
      const repoInfo = testRepoData['coolstore'];

      const originalEnv = {
        HUB_URL: process.env.HUB_URL,
        HUB_USERNAME: process.env.HUB_USERNAME,
        HUB_PASSWORD: process.env.HUB_PASSWORD,
        FORCE_HUB_ENABLED: process.env.FORCE_HUB_ENABLED,
        HUB_INSECURE: process.env.HUB_INSECURE,
        HUB_SOLUTION_SERVER_ENABLED: process.env.HUB_SOLUTION_SERVER_ENABLED,
        HUB_PROFILE_SYNC_ENABLED: process.env.HUB_PROFILE_SYNC_ENABLED,
      };

      let vscodeApp: VSCode | undefined;

      try {
        process.env.HUB_URL = 'http://localhost:8080';
        process.env.HUB_USERNAME = 'admin';
        process.env.HUB_PASSWORD = 'password';
        process.env.FORCE_HUB_ENABLED = 'true';
        process.env.HUB_INSECURE = 'true';
        process.env.HUB_SOLUTION_SERVER_ENABLED = 'true';
        process.env.HUB_PROFILE_SYNC_ENABLED = 'true';

        console.log('Launching VS Code with Hub env vars set to enable all features');

        vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);

        await HubConfigurationPage.open(vscodeApp);
        const view = await vscodeApp.getView(KAIViews.hubConfiguration);
        const hubToggle = view.locator('input#hub-enabled');
        await expect(hubToggle).toBeChecked();
        await expect(hubToggle).toBeDisabled();

        await expect(
          view.locator('text=Hub connection is enforced by environment configuration')
        ).toBeVisible();
        await expect(view.locator('#hub-url')).toHaveValue(process.env.HUB_URL);
        await expect(view.locator('input#auth-enabled')).toBeChecked();
        await expect(view.locator('#auth-username')).toHaveValue(process.env.HUB_USERNAME);
        await expect(view.locator('#auth-password')).toHaveValue(process.env.HUB_PASSWORD);
        await expect(view.locator('input#auth-insecure')).toBeChecked();
        await expect(view.locator('input#feature-solution-server')).toBeChecked();
        await expect(view.locator('input#feature-profile-sync')).toBeChecked();

        console.log('All features verified as enabled via environment variables');
      } finally {
        restoreOriginalEnvVariables(originalEnv);
        if (vscodeApp) {
          await vscodeApp.closeVSCode();
        }
      }
    });

    test('Verify all features disabled via environment variables', async ({ testRepoData }) => {
      const repoInfo = testRepoData['coolstore'];

      const originalEnv = {
        HUB_URL: process.env.HUB_URL,
        HUB_USERNAME: process.env.HUB_USERNAME,
        HUB_PASSWORD: process.env.HUB_PASSWORD,
        FORCE_HUB_ENABLED: process.env.FORCE_HUB_ENABLED,
        HUB_INSECURE: process.env.HUB_INSECURE,
        HUB_SOLUTION_SERVER_ENABLED: process.env.HUB_SOLUTION_SERVER_ENABLED,
        HUB_PROFILE_SYNC_ENABLED: process.env.HUB_PROFILE_SYNC_ENABLED,
      };

      let vscodeApp: VSCode | undefined;

      try {
        process.env.HUB_URL = 'http://localhost:8080';
        process.env.HUB_USERNAME = 'admin';
        process.env.HUB_PASSWORD = 'password';
        delete process.env.FORCE_HUB_ENABLED;
        process.env.HUB_INSECURE = 'false';
        process.env.HUB_SOLUTION_SERVER_ENABLED = 'false';
        process.env.HUB_PROFILE_SYNC_ENABLED = 'false';

        console.log('Launching VS Code with Hub env vars set to disable optional features');

        vscodeApp = await VSCodeFactory.init(repoInfo.repoUrl, repoInfo.repoName, repoInfo.branch);

        await HubConfigurationPage.open(vscodeApp);
        const view = await vscodeApp.getView(KAIViews.hubConfiguration);
        const hubToggle = view.locator('input#hub-enabled');
        await expect(hubToggle).toBeChecked();
        await expect(hubToggle).toBeEnabled();

        await expect(view.locator('#hub-url')).toHaveValue(process.env.HUB_URL);
        await expect(view.locator('input#auth-enabled')).toBeChecked();
        await expect(view.locator('input#auth-insecure')).not.toBeChecked();
        await expect(view.locator('input#feature-solution-server')).not.toBeChecked();
        await expect(view.locator('input#feature-profile-sync')).not.toBeChecked();

        console.log('All features verified as disabled via environment variables');
      } finally {
        restoreOriginalEnvVariables(originalEnv);
        if (vscodeApp) {
          await vscodeApp.closeVSCode();
        }
      }
    });

    const restoreOriginalEnvVariables = (originalEnv: { [key: string]: string | undefined }) => {
      Object.keys(originalEnv).forEach((key) => {
        const value = originalEnv[key as keyof typeof originalEnv];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });
    };
  }
);
