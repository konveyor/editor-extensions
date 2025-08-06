import { execSync } from 'child_process';
import fs from 'fs';
import { downloadFile } from './download.utils';

export function isExtensionInstalled(extension: string) {
  const installedExtensions = execSync('code --list-extensions', {
    encoding: 'utf-8',
  });

  return installedExtensions.includes(extension);
}

export async function installExtension(): Promise<void> {
  try {
    if (isExtensionInstalled('konveyor.konveyor-ai')) {
      console.log(`Extension already installed`);
      return;
    }

    let extensionPath = '';
    if (process.env.VSIX_FILE_PATH && fs.existsSync(process.env.VSIX_FILE_PATH)) {
      console.log(`vsix present in ${process.env.VSIX_FILE_PATH}`);
      extensionPath = process.env.VSIX_FILE_PATH;
    } else if (process.env.VSIX_DOWNLOAD_URL) {
      console.log(`vsix downloaded from ${process.env.VSIX_DOWNLOAD_URL}`);
      extensionPath = 'extension.vsix';
      await downloadFile(process.env.VSIX_DOWNLOAD_URL, extensionPath);
    } else {
      throw new Error(
        `Extension installation failed: No valid VSIX file path or download URL available: ${extensionPath}`
      );
    }

    execSync(`code --install-extension "${extensionPath}"`, {
      stdio: 'inherit',
    });
    console.log('Extension installed successfully.');
  } catch (error) {
    console.error('Error installing the VSIX extension:', error);
    throw error;
  }
}
