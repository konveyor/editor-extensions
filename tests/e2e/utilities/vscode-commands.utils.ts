import { execSync } from 'child_process';
import fs from 'fs';
import { downloadFile } from './download.utils';
import { extensionId } from './utils';

export function isExtensionInstalled(extension: string) {
  const installedExtensions = execSync('code --list-extensions', {
    encoding: 'utf-8',
  });

  return installedExtensions.includes(extension);
}

/**
 * Determines if extension installation should proceed based on:
 * - Whether a VSIX file is explicitly provided (always install)
 * - Whether the extension is already installed (skip if no VSIX)
 */
function shouldInstallExtension(): boolean {
  const hasExplicitVsix = process.env.VSIX_FILE_PATH || process.env.VSIX_DOWNLOAD_URL;

  // Always install when VSIX is explicitly provided
  if (hasExplicitVsix) {
    return true;
  }

  // In dev mode, skip if already installed
  return !isExtensionInstalled(extensionId);
}

export async function installExtension(): Promise<void> {
  try {
    if (!shouldInstallExtension()) {
      console.log(`Extension already installed`);
      return;
    }

    let extensionPath = '';
    if (process.env.VSIX_FILE_PATH && fs.existsSync(process.env.VSIX_FILE_PATH)) {
      console.log(`Installing VSIX from ${process.env.VSIX_FILE_PATH}`);
      extensionPath = process.env.VSIX_FILE_PATH;
    } else if (process.env.VSIX_DOWNLOAD_URL) {
      console.log(`Downloading VSIX from ${process.env.VSIX_DOWNLOAD_URL}`);
      extensionPath = 'extension.vsix';
      await downloadFile(process.env.VSIX_DOWNLOAD_URL, extensionPath);
    } else {
      throw new Error(
        `Extension installation failed: No valid VSIX file path or download URL available: ${extensionPath}`
      );
    }

    const installCommand = `code --install-extension "${extensionPath}"`;

    execSync(installCommand, {
      stdio: 'inherit',
    });
    console.log('Extension installed/updated successfully.');
  } catch (error) {
    console.error('Error installing the VSIX extension:', error);
    throw error;
  }
}
