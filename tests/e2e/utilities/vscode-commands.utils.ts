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
  const hasExplicitVsix = process.env.CORE_VSIX_FILE_PATH || process.env.CORE_VSIX_DOWNLOAD_URL;

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

    // Install konveyor core extension
    let coreExtensionPath = '';
    if (process.env.CORE_VSIX_FILE_PATH && fs.existsSync(process.env.CORE_VSIX_FILE_PATH)) {
      console.log(`Installing core VSIX from ${process.env.CORE_VSIX_FILE_PATH}`);
      coreExtensionPath = process.env.CORE_VSIX_FILE_PATH;
    } else if (process.env.CORE_VSIX_DOWNLOAD_URL) {
      console.log(`Downloading VSIX from ${process.env.CORE_VSIX_DOWNLOAD_URL}`);
      coreExtensionPath = 'extension.vsix';
      await downloadFile(process.env.CORE_VSIX_DOWNLOAD_URL, coreExtensionPath);
    } else {
      throw new Error(
        `Extension installation failed: No valid core VSIX file path or download URL available`
      );
    }

    execSync(`code --install-extension "${coreExtensionPath}" --force`, { stdio: 'inherit' });
    console.log('Konveyor core extension installed/updated successfully.');

    // Verify core extension is actually installed
    if (!isExtensionInstalled('konveyor.konveyor')) {
      throw new Error('Core extension (konveyor.konveyor) was not installed successfully');
    }

    // Install konveyor-java extension if path provided
    if (process.env.JAVA_VSIX_FILE_PATH && fs.existsSync(process.env.JAVA_VSIX_FILE_PATH)) {
      console.log(`Installing Konveyor Java VSIX from ${process.env.JAVA_VSIX_FILE_PATH}`);
      execSync(`code --install-extension "${process.env.JAVA_VSIX_FILE_PATH}" --force`, {
        stdio: 'inherit',
      });
      console.log('Java extension installed/updated successfully.');
    }
  } catch (error) {
    console.error('Error installing the VSIX extension:', error);
    throw error;
  }
}
