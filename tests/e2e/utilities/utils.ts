import * as os from 'os';
import * as fs from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';
import type { TestInfo } from '@playwright/test';
import { rm } from 'node:fs/promises';
import process from 'process';
import { expect } from '@playwright/test';
import type { VSCode } from '../pages/vscode.page';
import { LogEntry } from '../types/log-entry';
import { HubConfiguration } from '../types/hub-configuration';

// ============================================================================
// Extension ID Configuration
// ============================================================================
// This section defines all extension IDs used in tests. These can be overridden
// via environment variables to support downstream rebranding.
//
// Pattern for adding new extensions:
// 1. Add EXTENSION_NAME and EXTENSION_PUBLISHER env vars (if different from konveyor)
// 2. Compute extensionId as `${publisher}.${name}`
// 3. Add any external dependencies the extension requires
// 4. Document the env vars below
//
// Environment Variables:
// - EXTENSION_PUBLISHER: Publisher for all Konveyor extensions (default: 'konveyor')
// - CORE_EXTENSION_NAME: Name of the core extension (default: 'konveyor-core')
// - JAVA_EXTENSION_NAME: Name of the Java extension (default: 'konveyor-java')
// - JAVASCRIPT_EXTENSION_NAME: Name of the JavaScript extension (default: 'konveyor-javascript')
// - GO_EXTENSION_NAME: Name of the Go extension (default: 'konveyor-go')
// - CSHARP_EXTENSION_NAME: Name of the C# extension (default: 'konveyor-csharp')
// - PACK_EXTENSION_NAME: Name of the extension pack (default: 'konveyor')
//
// External dependency overrides:
// - REDHAT_JAVA_EXTENSION_ID: Full ID of Red Hat Java extension (default: 'redhat.java')
// - GOLANG_GO_EXTENSION_ID: Full ID of Golang extension (default: 'golang.go')
// ============================================================================

// Publisher (shared by all Konveyor extensions)
export const extensionPublisher = process.env.EXTENSION_PUBLISHER || 'konveyor';

// Core extension
export const coreExtensionName = process.env.CORE_EXTENSION_NAME || 'konveyor-core';
export const coreExtensionId = `${extensionPublisher}.${coreExtensionName}`;

// Java extension
export const javaExtensionName = process.env.JAVA_EXTENSION_NAME || 'konveyor-java';
export const javaExtensionId = `${extensionPublisher}.${javaExtensionName}`;

// JavaScript extension
export const javascriptExtensionName =
  process.env.JAVASCRIPT_EXTENSION_NAME || 'konveyor-javascript';
export const javascriptExtensionId = `${extensionPublisher}.${javascriptExtensionName}`;

// Go extension
export const goExtensionName = process.env.GO_EXTENSION_NAME || 'konveyor-go';
export const goExtensionId = `${extensionPublisher}.${goExtensionName}`;

// C# extension
export const csharpExtensionName = process.env.CSHARP_EXTENSION_NAME || 'konveyor-csharp';
export const csharpExtensionId = `${extensionPublisher}.${csharpExtensionName}`;

// Extension Pack
export const packExtensionName = process.env.PACK_EXTENSION_NAME || 'konveyor';
export const packExtensionId = `${extensionPublisher}.${packExtensionName}`;

// External dependency extensions
export const redhatJavaExtensionId = process.env.REDHAT_JAVA_EXTENSION_ID || 'redhat.java';
export const golangGoExtensionId = process.env.GOLANG_GO_EXTENSION_ID || 'golang.go';

// ============================================================================
// Backward Compatibility Aliases
// ============================================================================
// Maintain backward compatibility with existing code
export const extensionName = coreExtensionName;
export const extensionId = coreExtensionId;

// ============================================================================
// Extension Dependency Map
// ============================================================================
// Maps each extension to its required dependencies for verification
export const extensionDependencies: Record<string, string[]> = {
  [coreExtensionId]: [],
  [javaExtensionId]: [coreExtensionId, redhatJavaExtensionId],
  [javascriptExtensionId]: [coreExtensionId],
  [goExtensionId]: [coreExtensionId, golangGoExtensionId],
  [csharpExtensionId]: [coreExtensionId],
  [packExtensionId]: [
    coreExtensionId,
    javaExtensionId,
    javascriptExtensionId,
    goExtensionId,
    csharpExtensionId,
  ],
};

// ============================================================================
// Other Configuration
// ============================================================================
export const extensionShortName = process.env.TEST_CATEGORY || 'Konveyor';

// Function to get the analysis view title based on extension short name
export function getAnalysisViewTitle(): string {
  return `${extensionShortName} Analysis View`;
}

// Function to get OS information
export function getOSInfo(): string {
  const platform: NodeJS.Platform = os.platform();

  switch (platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macOS';
    case 'linux':
      return 'linux';
    default:
      return `Unknown OS: ${platform}`;
  }
}

export async function cleanupRepo(repoDir: string) {
  if (!repoDir) {
    console.debug(`Directory ${repoDir} does not exist, skipping cleanup.`);
    return;
  }
  const repoPath = path.resolve(process.cwd(), repoDir);
  if (!fs.existsSync(repoPath)) {
    console.debug(`cleanupRepo: Directory ${repoPath} does not exist. Skipping cleanup.`);
    return;
  }

  try {
    await rm(repoPath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 5000,
    });
    console.debug(`cleanupRepo: Successfully deleted directory ${repoPath}`);
  } catch (error) {
    console.error('Error while cleaning up cloned repository:', error);
  }
}

export async function uninstallExtension() {
  try {
    execSync(`code --uninstall-extension ${extensionId}`, {
      stdio: 'inherit',
    });
  } catch (error) {
    console.error('Error uninstalling Konveyor extension:', error);
  }
}

export function getVscodeExecutablePath() {
  return getOSInfo() === 'windows'
    ? process.env.WINDOWS_VSCODE_EXECUTABLE_PATH
    : process.env.VSCODE_EXECUTABLE_PATH || '/usr/share/code/code';
}

export function getRepoName(testInfo: TestInfo): string {
  const repoName = path.basename(testInfo.file).replace('.test.ts', '');
  const parts = repoName.split('_');
  if (parts.length < 2) {
    throw new Error(
      `Invalid test file name format: ${testInfo.file}. Expected format: prefix_reponame.test.ts`
    );
  }
  return parts[parts.length - 1];
}

export function generateRandomString(length: number = 8): string {
  return Math.random()
    .toString(36)
    .substring(2, 2 + length);
}

export function writeOrUpdateSettingsJson(settingsPath: string, settings: Record<string, any>) {
  try {
    const vscodeDir = path.dirname(settingsPath);
    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir, { recursive: true });
    }
    let existingSettings: Record<string, any> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        const existingContent = fs.readFileSync(settingsPath, 'utf-8');
        existingSettings = JSON.parse(existingContent);
      } catch (parseError) {
        console.warn(
          `Failed to parse existing settings.json, starting with empty settings: ${parseError}`
        );
        existingSettings = {};
      }
    }
    const mergedSettings = { ...existingSettings, ...settings };
    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error writing VSCode settings:', error);
    throw error;
  }
}

/**
 * Verifies that the analysis view is in a clean, interactive state after test completion.
 * This includes navigating back to the analysis view, checking for no loading elements,
 * verifying the analysis table is visible, and taking a final screenshot.
 *
 * @param vscodeApp - The VSCode instance
 * @param screenshotPath - Path for the final screenshot
 * @param logPrefix - Prefix for console log messages (e.g., "Agent flow" or "Non-agent flow")
 */
export async function verifyAnalysisViewCleanState(
  vscodeApp: VSCode,
  screenshotPath: string,
  logPrefix: string = 'Test'
): Promise<void> {
  // Navigate back to the analysis view to verify the table is shown properly
  await vscodeApp.openAnalysisView();
  console.log(`${logPrefix}: Navigated back to analysis view`);

  // Import KAIViews locally to avoid circular dependency
  const { KAIViews } = await import('../enums/views.enum');

  // Verify that the analysis table is visible and there are no loading elements
  const returnedAnalysisView = await vscodeApp.getView(KAIViews.analysisView);

  // Wait for any loading to complete - check for backdrop, spinners, and waiting messages
  const backdrop = returnedAnalysisView.locator('.pf-v6-c-backdrop');
  const spinner = returnedAnalysisView.locator('.pf-v6-c-spinner');
  const waitingText = returnedAnalysisView.getByText('Waiting for user action...');

  await expect(backdrop).not.toBeVisible({ timeout: 30000 });
  await expect(spinner).not.toBeVisible({ timeout: 30000 });
  await expect(waitingText).not.toBeVisible({ timeout: 30000 });
  console.log(
    `${logPrefix}: Verified no backdrop overlay, spinners, or waiting messages are present`
  );

  // Verify that the analysis table/results are visible
  const analysisTable = returnedAnalysisView.locator('[data-ouia-component-type="PF6/Card"]');
  await expect(analysisTable.first()).toBeVisible({ timeout: 30000 });
  console.log(`${logPrefix}: Verified analysis table is visible`);

  // Take final screenshot showing the analysis view with table displayed
  await vscodeApp.getWindow().screenshot({ path: screenshotPath });
  console.log(`${logPrefix}: Final screenshot saved to ${screenshotPath}`);
}

export function parseLogEntries(rawContent: string): LogEntry[] {
  const entries: LogEntry[] = [];

  const normalized = rawContent.replace(/\}\s*\{/g, '}\n{');

  const lines = normalized.split('\n');
  let buffer = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    buffer += trimmed;

    try {
      const parsed = JSON.parse(buffer);
      entries.push(parsed);
      buffer = '';
    } catch (e) {
      const openBraces = (buffer.match(/\{/g) || []).length;
      const closeBraces = (buffer.match(/\}/g) || []).length;
      if (closeBraces > openBraces) {
        console.warn(`Discarding trailing fragment: ${buffer.substring(0, 50)}...`);
        buffer = trimmed.startsWith('{') ? trimmed : '';
      }
    }
  }

  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer);
      entries.push(parsed);
    } catch (e) {
      console.warn(`Failed to parse remaining buffer: ${buffer.substring(0, 100)}...`);
    }
  }

  return entries;
}

export function getHubConfig(
  toEnableSolutionServer: boolean,
  toEnableAuth: boolean,
  toSyncProfiles: boolean
): HubConfiguration {
  const url = process.env.SOLUTION_SERVER_URL;
  if (!url) {
    throw new Error('Missing required URL');
  }

  const baseConfig: HubConfiguration = {
    enabled: true,
    url,
    skipSSL: true,
    solutionServerEnabled: toEnableSolutionServer,
    profileSyncEnabled: toSyncProfiles,
  };

  if (!toEnableAuth) {
    return baseConfig;
  }

  const username = process.env.SOLUTION_SERVER_USERNAME;
  const password = process.env.SOLUTION_SERVER_PASSWORD;

  if (!username || !password) {
    throw new Error('Missing solution server credentials');
  }

  return {
    ...baseConfig,
    auth: {
      enabled: true,
      username,
      password,
    },
  };
}
