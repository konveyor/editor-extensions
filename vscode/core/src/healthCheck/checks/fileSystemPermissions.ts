/**
 * Health check for file system permissions and workspace access
 */

import * as fs from "fs-extra";
import * as path from "path";
import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import { CheckResultBuilder, withErrorHandling, formatError } from "../helpers";

interface WriteTestResult {
  location: string;
  writable: boolean;
  error?: string;
}

async function testDirectoryWritable(
  dirPath: string,
  locationName: string,
): Promise<WriteTestResult> {
  try {
    await fs.ensureDir(dirPath);
    const testFile = path.join(dirPath, `.konveyor-health-${Date.now()}.tmp`);
    await fs.writeFile(testFile, "test");
    await fs.remove(testFile);
    return { location: locationName, writable: true };
  } catch (err) {
    return {
      location: locationName,
      writable: false,
      error: formatError(err),
    };
  }
}

export const fileSystemPermissionsCheck: HealthCheckModule = {
  id: "filesystem-permissions",
  name: "File System Permissions",
  description: "Checks if the extension can write to required directories",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { state, logger } = context;
    const builder = new CheckResultBuilder("File System Permissions");

    return withErrorHandling("File System Permissions", logger, async () => {
      const workspaceRoot = state.data.workspaceRoot;
      if (!workspaceRoot) {
        return builder.warning(
          "No workspace folder is open",
          undefined,
          "Open a workspace folder to enable analysis functionality",
        );
      }

      const testResults: WriteTestResult[] = await Promise.all([
        testDirectoryWritable(path.join(workspaceRoot, ".vscode"), ".vscode/"),
        testDirectoryWritable(state.extensionContext.globalStorageUri.fsPath, "Global Storage"),
        ...(state.extensionContext.storageUri?.fsPath
          ? [testDirectoryWritable(state.extensionContext.storageUri.fsPath, "Workspace Storage")]
          : []),
        testDirectoryWritable(state.extensionContext.logUri.fsPath, "Log Directory"),
      ]);

      const failedLocations = testResults.filter((r) => !r.writable);
      const passedCount = testResults.filter((r) => r.writable).length;

      if (failedLocations.length > 0) {
        const failedDetails = failedLocations
          .map((loc) => `  - ${loc.location}: ${loc.error}`)
          .join("\n");
        const details = `Passed: ${passedCount}/${testResults.length}\n\nFailed Locations:\n${failedDetails}`;

        return builder.fail(
          `Cannot write to ${failedLocations.length} required location(s)`,
          details,
          "Check file system permissions. Workspace may be on read-only mount or network share with restricted access.",
        );
      }

      const locationList = testResults.map((loc) => `  ✓ ${loc.location}`).join("\n");
      const details = `All ${testResults.length} required directories are writable:\n${locationList}`;

      return builder.pass("All required directories are writable", details);
    });
  },
};
