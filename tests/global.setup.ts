import { VSCode } from './e2e/pages/vscode.page';
import { generateRandomString, getOSInfo } from './e2e/utilities/utils';
import { isExtensionInstalled } from './e2e/utilities/vscode-commands.utils';
import { KAIViews } from './e2e/enums/views.enum';

async function globalSetup() {
  console.log('Running global setup...');
  let vscodeApp = await VSCode.init('https://github.com/konveyor-ecosystem/coolstore', 'coolstore');

  if (!isExtensionInstalled('redhat.java')) {
    throw new Error(
      'Required extension `redhat.java` was not found. It should have been installed automatically as a dependency'
    );
  }

  if (getOSInfo() === 'windows' && process.env.CI) {
    await vscodeApp.getWindow().waitForTimeout(60000);
  }

  const javaReadySelector = vscodeApp.getWindow().getByRole('button', { name: 'Java: Ready' });

  await javaReadySelector.waitFor({ timeout: 120000 });
  // Sometimes the java ready status is displayed for a few seconds before starting to load again
  // This checks that the state is kept for a few seconds before continuing
  await vscodeApp.waitDefault();
  await javaReadySelector.waitFor({ timeout: 1200000 });

  await vscodeApp.openAnalysisView();

  await vscodeApp.closeVSCode();

  console.log('Completed global setup.');
  if (getOSInfo() === 'windows' && process.env.CI) {
    const vscodeApp = await VSCode.open(
      'https://github.com/konveyor-ecosystem/coolstore',
      'coolstore'
    );
    await vscodeApp.createProfile([], ['openjdk17'], generateRandomString());
    await vscodeApp.configureGenerativeAI();
    await vscodeApp.openAnalysisView();
    const analysisView = await vscodeApp.getView(KAIViews.analysisView);
    console.log('Starting server...');
    const startButton = analysisView.getByRole('button', { name: 'Start' });
    await startButton.waitFor({ state: 'visible', timeout: 10000 });
    await startButton.click({ delay: 500 });
    await vscodeApp.getWindow().waitForTimeout(60000);
    await vscodeApp.closeVSCode();
  }
}

export default globalSetup;
