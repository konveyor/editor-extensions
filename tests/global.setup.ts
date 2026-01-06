import { generateRandomString, getOSInfo } from './e2e/utilities/utils';
import { KAIViews } from './e2e/enums/views.enum';
import * as VSCodeFactory from './e2e/utilities/vscode.factory';
import { VSCodeDesktop } from './e2e/pages/vscode-desktop.page';

async function globalSetup() {
  const repoUrl = process.env.TEST_REPO_URL ?? 'https://github.com/konveyor-ecosystem/coolstore';
  const repoName = process.env.TEST_REPO_NAME ?? 'coolstore';
  console.log('Running global setup...');
  const vscodeApp = await VSCodeFactory.init(repoUrl, repoName);

  if (getOSInfo() === 'windows' && process.env.CI) {
    await vscodeApp.getWindow().waitForTimeout(60000);
  }

  // Wait for extension initialization
  // Both redhat.java and konveyor-java extensions will activate automatically
  // via workspaceContains activation events (pom.xml, build.gradle, etc.)
  if (vscodeApp instanceof VSCodeDesktop) {
    await vscodeApp.waitForExtensionInitialization();
  }

  await vscodeApp.openAnalysisView();
  await vscodeApp.closeVSCode();
  console.log('Completed global setup.');

  if (getOSInfo() === 'windows' && process.env.CI) {
    const vscodeApp = await VSCodeFactory.open(repoUrl, repoName, 'main', true);
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
