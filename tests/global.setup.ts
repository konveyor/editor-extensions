import { VSCode } from './e2e/pages/vscode.page';
import { getOSInfo } from './e2e/utilities/utils';
import { isExtensionInstalled } from './e2e/utilities/vscode-commands.utils';

async function globalSetup() {
  console.log('Running global setup...');
  const vscodeApp = await VSCode.init(
    'https://github.com/konveyor-ecosystem/coolstore',
    'coolstore'
  );

  if (!isExtensionInstalled('redhat.java')) {
    throw new Error(
      'Required extension `redhat.java` was not found. It should have been installed automatically as a dependency'
    );
  }

  if (getOSInfo() === 'windows' && process.env.CI) {
    await vscodeApp.getWindow().waitForTimeout(60000);
  }

  const javaReadySelector = vscodeApp.getWindow().getByRole('button', { name: 'Java: Ready' });

  await javaReadySelector.waitFor({ timeout: 60000 });
  // Sometimes the java ready status is displayed for a few seconds before starting to load again
  // This checks that the state is kept for a few seconds before continuing
  await vscodeApp.waitDefault();
  await javaReadySelector.waitFor({ timeout: 60000 });

  await vscodeApp.openAnalysisView();
  console.log('Completed global setup.');
  await vscodeApp.closeVSCode();
}

export default globalSetup;
