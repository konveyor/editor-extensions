import { VSCode } from './e2e/pages/vscode.pages';
import { getOSInfo } from './e2e/utilities/utils';

async function globalSetup() {
  console.log('Running global setup...');
  const vscodeApp = await VSCode.init();
  if (getOSInfo() === 'windows' && process.env.CI) {
    await vscodeApp.getWindow().waitForTimeout(60000);
  }

  await vscodeApp.configureGenerativeAI();
  console.log('Completed global setup.');
  await vscodeApp.closeVSCode();
}

export default globalSetup;
