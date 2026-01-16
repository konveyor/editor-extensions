import * as pathlib from 'path';
import { RepoData, expect, test } from '../../fixtures/test-repo-fixture';
import { VSCode } from '../../pages/vscode.page';
import * as VSCodeFactory from '../../utilities/vscode.factory';
import { DEFAULT_PROVIDER } from '../../fixtures/provider-configs.fixture';
import { generateRandomString } from '../../utilities/utils';
import { KAIViews } from '../../enums/views.enum';
import { genAISettingKey } from '../../enums/configuration-options.enum';
import { SCREENSHOTS_FOLDER } from '../../utilities/consts';

test.describe.serial('TypeScript Extension - Configuration & UI', () => {
  let vscodeApp: VSCode;
  const randomString = generateRandomString();
  const profileName = `ts-automation-${randomString}`;
  let repoInfo: RepoData[string];
  const screenshotDir = pathlib.join(SCREENSHOTS_FOLDER, 'typescript-configuration-ui');

  test.beforeAll(async ({ testRepoData }) => {
    test.setTimeout(1200000);
    repoInfo = testRepoData['static-report'];
    // Use openForRepo which determines initialization based on repo language
    vscodeApp = await VSCodeFactory.openForRepo(repoInfo);
    // Wait for extensions to load
    console.log('Waiting for extensions to load...');
    await vscodeApp.getWindow().waitForTimeout(15000);
  });

  test.beforeEach(async () => {
    const testName = test.info().title.replace(/ /g, '-');
    console.log(`Starting ${testName} at ${new Date()}`);
    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, `before-${testName}.png`),
    });
  });

  test('Create Profile with custom rules for TypeScript', async () => {
    await vscodeApp.waitDefault();
    // Create profile with custom rules (PatternFly rulesets)
    // For TypeScript, we use custom rules folder instead of predefined targets
    await vscodeApp.createProfile(
      repoInfo.sources,
      repoInfo.targets,
      profileName,
      repoInfo.customRulesFolder
    );
    console.log(`Profile created: ${profileName}`);
  });

  test('Configure GenAI Provider', async () => {
    await vscodeApp.configureGenerativeAI(DEFAULT_PROVIDER.config);
    console.log('GenAI provider configured');
  });

  test('Start server', async () => {
    await vscodeApp.waitDefault();
    await vscodeApp.startServer();
    console.log('Server started successfully');
  });

  test('Run analysis', async () => {
    test.setTimeout(600000);
    await vscodeApp.waitDefault();
    await vscodeApp.openAnalysisView();
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Click Run Analysis button directly (TypeScript analysis may complete too fast for progress indicator)
    const runAnalysisBtn = analysisView.getByRole('button', { name: 'Run Analysis' });
    await expect(runAnalysisBtn).toBeEnabled({ timeout: 60000 });
    console.log('Clicking Run Analysis button...');
    await runAnalysisBtn.click();

    // Wait for analysis completion notification
    await vscodeApp.waitForAnalysisCompleted();
    console.log('Analysis completed successfully');
  });

  test('Verify analysis view is accessible after configuration', async () => {
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitDefault();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);

    // Verify the analysis view has expected UI elements
    const buttons = analysisView.locator('button');
    const buttonCount = await buttons.count();
    console.log(`Found ${buttonCount} buttons in analysis view`);
    expect(buttonCount).toBeGreaterThan(0);

    // Verify PatternFly components are rendered
    const pfComponents = analysisView.locator('[class*="pf-v6"]');
    const pfCount = await pfComponents.count();
    console.log(`Found ${pfCount} PatternFly components`);
    expect(pfCount).toBeGreaterThan(0);

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'analysis-view-accessible.png'),
    });
  });

  test('Disable and enable Generative AI', async () => {
    // Disable GenAI - use replaceAll to start with clean settings
    await vscodeApp.openWorkspaceSettingsAndWrite({ [genAISettingKey]: false }, true);
    await vscodeApp.openAnalysisView();
    await vscodeApp.waitDefault();

    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    const solutionButton = analysisView.locator('button#get-solution-button');

    // Verify GenAI warning is shown when disabled
    await expect(analysisView.getByRole('heading', { name: 'Warning alert: GenAI' })).toBeVisible({
      timeout: 30000,
    });
    await expect(analysisView.getByRole('button', { name: 'Enable GenAI' })).toBeVisible();
    await expect(analysisView.getByText('Agent Mode')).not.toBeVisible();
    await expect(solutionButton.first()).not.toBeVisible({ timeout: 10000 });
    console.log('GenAI disabled - warning shown correctly');

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'genai-disabled.png'),
    });

    // Enable GenAI - use replaceAll for clean settings
    await vscodeApp.openWorkspaceSettingsAndWrite({ [genAISettingKey]: true }, true);
    await vscodeApp.waitDefault();

    // Verify GenAI is enabled
    await expect(
      analysisView.getByRole('heading', { name: 'Warning alert: GenAI' })
    ).not.toBeVisible({ timeout: 30000 });
    await expect(analysisView.getByRole('button', { name: 'Enable GenAI' })).not.toBeVisible();
    await expect(analysisView.getByText('Agent Mode')).toBeVisible();
    await expect(solutionButton.first()).toBeVisible({ timeout: 30000 });
    console.log('GenAI enabled - controls visible');

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'genai-enabled.png'),
    });
  });

  test('Extension commands are available in command palette', async () => {
    await vscodeApp.waitDefault();

    // Open command palette
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await vscodeApp.getWindow().keyboard.press(`${modifier}+Shift+P`);
    await vscodeApp.getWindow().waitForTimeout(1000);

    // Type Konveyor to filter commands
    await vscodeApp.getWindow().keyboard.type('Konveyor', { delay: 50 });
    await vscodeApp.getWindow().waitForTimeout(1000);

    // Verify command list shows results
    const commandList = vscodeApp.getWindow().locator('.quick-input-list');
    await expect(commandList).toBeVisible({ timeout: 5000 });

    // Check for at least one command entry
    const commandEntries = vscodeApp.getWindow().locator('.quick-input-list-entry');
    const entryCount = await commandEntries.count();
    console.log(`Found ${entryCount} Konveyor commands in palette`);
    expect(entryCount).toBeGreaterThan(0);

    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, 'command-palette.png'),
    });

    // Close command palette
    await vscodeApp.getWindow().keyboard.press('Escape');
    await vscodeApp.waitDefault();
  });

  test('Delete profile', async () => {
    await vscodeApp.deleteProfile(profileName);
    console.log(`Profile deleted: ${profileName}`);
  });

  test.afterEach(async () => {
    const testName = test.info().title.replace(/ /g, '-');
    console.log(`Finished ${testName} at ${new Date()}`);
    await vscodeApp.getWindow().screenshot({
      path: pathlib.join(screenshotDir, `after-${testName}.png`),
    });
  });

  test.afterAll(async () => {
    await vscodeApp.closeVSCode();
  });
});
