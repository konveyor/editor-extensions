import { execSync } from 'child_process';
import fs from 'fs';
import { downloadFile } from './download.utils';
import { extensionId } from './utils';

/**
 * Helper function to get environment variables with NODE_OPTIONS cleared
 * to avoid ESM loader conflicts with VS Code
 */
function getCleanEnv() {
  return {
    ...process.env,
    NODE_OPTIONS: '', // Clear NODE_OPTIONS to avoid ESM loader conflicts
  };
}

export function isExtensionInstalled(extension: string) {
  try {
    const installedExtensions = execSync('code --list-extensions', {
      encoding: 'utf-8',
      env: getCleanEnv(),
    });

    return installedExtensions.includes(extension);
  } catch (error: any) {
    // Handle the V8/ESM loader error that occurs in CI environments
    console.warn(`Failed to list extensions: ${error.message}`);

    // In CI, we can assume the extension is not installed if we can't check
    if (process.env.CI) {
      console.log('CI environment detected, assuming extension not installed');
      return false;
    }

    // Re-throw in local development to catch actual issues
    throw error;
  }
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

    execSync(`code --install-extension "${coreExtensionPath}" --force`, {
      stdio: 'inherit',
      env: getCleanEnv(),
    });
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
        env: getCleanEnv(),
      });
      console.log('Java extension installed/updated successfully.');

      // Wait a moment for VSCode to process extension dependencies
      // VSCode should automatically install extensionDependencies (like redhat.java)
      console.log('Waiting for VSCode to process extension dependencies...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Verify that redhat.java was installed as a dependency
      if (!isExtensionInstalled('redhat.java')) {
        console.warn('Warning: redhat.java was not automatically installed as a dependency.');
        console.warn('This may indicate an issue with extension dependency resolution.');
        console.warn('Installing redhat.java manually...');
        execSync('code --install-extension redhat.java --force', {
          stdio: 'inherit',
          env: getCleanEnv(),
        });
      } else {
        console.log('Verified: redhat.java is installed (dependency of konveyor-java).');
      }
    }
  } catch (error) {
    console.error('Error installing the VSIX extension:', error);
    throw error;
  }
}
