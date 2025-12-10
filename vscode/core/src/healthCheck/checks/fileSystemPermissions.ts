/**
 * Health check for file system permissions and workspace access
 */

import * as fs from "fs-extra";
import * as path from "path";
import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";

export const fileSystemPermissionsCheck: HealthCheckModule = {
  id: "filesystem-permissions",
  name: "File System Permissions",
  description: "Checks if the extension can write to required directories",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { state, vscode, logger } = context;

    try {
      const workspaceRoot = state.data.workspaceRoot;
      if (!workspaceRoot) {
        return {
          name: "File System Permissions",
          status: "warning",
          message: "No workspace folder is open",
          suggestion: "Open a workspace folder to enable analysis functionality",
        };
      }

      const testResults: { location: string; writable: boolean; error?: string }[] = [];

      // Test 1: Workspace .vscode directory
      const vscodeDir = path.join(workspaceRoot, ".vscode");
      try {
        await fs.ensureDir(vscodeDir);
        const testFile = path.join(vscodeDir, `.konveyor-health-${Date.now()}.tmp`);
        await fs.writeFile(testFile, "test");
        await fs.remove(testFile);
        testResults.push({ location: ".vscode/", writable: true });
      } catch (err) {
        testResults.push({
          location: ".vscode/",
          writable: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Test 2: Extension global storage (for settings, cached responses)
      const globalStoragePath = state.extensionContext.globalStorageUri.fsPath;
      try {
        await fs.ensureDir(globalStoragePath);
        const testFile = path.join(globalStoragePath, `.konveyor-health-${Date.now()}.tmp`);
        await fs.writeFile(testFile, "test");
        await fs.remove(testFile);
        testResults.push({ location: "Global Storage", writable: true });
      } catch (err) {
        testResults.push({
          location: "Global Storage",
          writable: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Test 3: Extension workspace storage (for analysis data)
      const workspaceStoragePath = state.extensionContext.storageUri?.fsPath;
      if (workspaceStoragePath) {
        try {
          await fs.ensureDir(workspaceStoragePath);
          const testFile = path.join(workspaceStoragePath, `.konveyor-health-${Date.now()}.tmp`);
          await fs.writeFile(testFile, "test");
          await fs.remove(testFile);
          testResults.push({ location: "Workspace Storage", writable: true });
        } catch (err) {
          testResults.push({
            location: "Workspace Storage",
            writable: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Test 4: Log directory
      const logPath = state.extensionContext.logUri.fsPath;
      try {
        await fs.ensureDir(logPath);
        const testFile = path.join(logPath, `.konveyor-health-${Date.now()}.tmp`);
        await fs.writeFile(testFile, "test");
        await fs.remove(testFile);
        testResults.push({ location: "Log Directory", writable: true });
      } catch (err) {
        testResults.push({
          location: "Log Directory",
          writable: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const failedLocations = testResults.filter((r) => !r.writable);
      const passedCount = testResults.filter((r) => r.writable).length;

      if (failedLocations.length > 0) {
        let details = `Passed: ${passedCount}/${testResults.length}\n\nFailed Locations:\n`;
        for (const loc of failedLocations) {
          details += `  - ${loc.location}: ${loc.error}\n`;
        }

        return {
          name: "File System Permissions",
          status: "fail",
          message: `Cannot write to ${failedLocations.length} required location(s)`,
          details,
          suggestion:
            "Check file system permissions. Workspace may be on read-only mount or network share with restricted access.",
        };
      }

      let details = `All ${testResults.length} required directories are writable:\n`;
      for (const loc of testResults) {
        details += `  . ${loc.location}\n`;
      }

      return {
        name: "File System Permissions",
        status: "pass",
        message: "All required directories are writable",
        details,
      };
    } catch (err) {
      logger.error("Error checking file system permissions", err);
      return {
        name: "File System Permissions",
        status: "fail",
        message: "Failed to check file system permissions",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
