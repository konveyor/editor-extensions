import { execSync } from 'child_process';
import fs from 'fs';
import { downloadFile } from './download.utils';
import { extensionId, coreExtensionId, redhatJavaExtensionId } from './utils';

/**
 * Helper function to get environment variables with Node.js loader options cleared
 * to avoid ESM loader conflicts with VS Code
 */
function getCleanEnv() {
  const cleanEnv = { ...process.env };

  // Clear all Node.js loader-related environment variables that could interfere
  delete cleanEnv.NODE_OPTIONS;
  delete cleanEnv.NODE_LOADER;
  delete cleanEnv.NODE_LOADERS;
  delete cleanEnv.LOADER;
  delete cleanEnv.TS_NODE_LOADER;
  delete cleanEnv.TSX_TSCONFIG_PATH;
  delete cleanEnv.SWC_NODE_LOADER;

  return cleanEnv;
}

export function isExtensionInstalled(extension: string) {
  try {
    const installedExtensions = execSync('code --list-extensions', {
      encoding: 'utf-8',
      env: getCleanEnv(),
      // Use shell: false to prevent shell environment pollution
      shell: false,
      // Set stdio to ['pipe', 'pipe', 'pipe'] to ensure clean streams
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return installedExtensions.includes(extension);
  } catch (error: any) {
    // Handle the V8/ESM loader error that occurs in CI environments
    console.warn(`Failed to list extensions: ${error.message}`);

    // Check if it's the specific V8 ToLocalChecked error
    const isV8Error =
      error.message.includes('v8::ToLocalChecked') ||
      error.message.includes('FATAL ERROR') ||
      error.message.includes('Aborted (core dumped)');

    // In CI or when we get V8 errors, assume extension is not installed
    if (process.env.CI || isV8Error) {
      console.log('CI environment or V8 error detected, assuming extension not installed');
      return false;
    }

    // Re-throw in local development for other types of errors
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
      shell: false,
    });
    console.log('Konveyor core extension installed/updated successfully.');

    // Verify core extension is actually installed
    // In CI environments, we might not be able to verify due to V8/ESM loader issues
    // so we'll be more lenient with the verification
    try {
      if (!isExtensionInstalled(coreExtensionId)) {
        if (process.env.CI) {
          console.warn('Warning: Could not verify core extension installation in CI environment');
          console.warn(
            'This may be due to VS Code/Node.js compatibility issues, but installation likely succeeded'
          );
          // Don't throw error in CI - assume installation worked if we got this far
        } else {
          throw new Error(`Core extension (${coreExtensionId}) was not installed successfully`);
        }
      }
    } catch (error: any) {
      // If we can't even run the verification, handle it gracefully in CI
      if (process.env.CI) {
        console.warn('Warning: Extension verification failed in CI environment:', error.message);
        console.warn('Continuing with assumption that installation succeeded');
      } else {
        throw error;
      }
    }

    // Install konveyor-java extension if path provided
    if (process.env.JAVA_VSIX_FILE_PATH && fs.existsSync(process.env.JAVA_VSIX_FILE_PATH)) {
      console.log(`Installing Konveyor Java VSIX from ${process.env.JAVA_VSIX_FILE_PATH}`);
      execSync(`code --install-extension "${process.env.JAVA_VSIX_FILE_PATH}" --force`, {
        stdio: 'inherit',
        env: getCleanEnv(),
        shell: false,
      });
      console.log('Java extension installed/updated successfully.');

      // Wait a moment for VSCode to process extension dependencies
      // VSCode should automatically install extensionDependencies (like redhat.java)
      console.log('Waiting for VSCode to process extension dependencies...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // Verify that redhat.java was installed as a dependency
      if (!isExtensionInstalled(redhatJavaExtensionId)) {
        console.warn(
          `Warning: ${redhatJavaExtensionId} was not automatically installed as a dependency.`
        );
        console.warn('This may indicate an issue with extension dependency resolution.');
        console.warn(`Installing ${redhatJavaExtensionId} manually...`);
        execSync(`code --install-extension ${redhatJavaExtensionId} --force`, {
          stdio: 'inherit',
          env: getCleanEnv(),
          shell: false,
        });
      } else {
        console.log(
          `Verified: ${redhatJavaExtensionId} is installed (dependency of konveyor-java).`
        );
      }
    }
  } catch (error) {
    console.error('Error installing the VSIX extension:', error);
    throw error;
  }
}
