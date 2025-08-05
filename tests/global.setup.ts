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

  await vscodeApp
    .getWindow()
    .getByRole('button', { name: 'Java: Ready' })
    .waitFor({ timeout: 30000 });

  await vscodeApp.openAnalysisView();
  console.log('Completed global setup.');
  await vscodeApp.closeVSCode();
}

export default globalSetup;
