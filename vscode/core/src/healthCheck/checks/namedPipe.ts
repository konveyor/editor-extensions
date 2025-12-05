/**
 * Health check for named pipe communication capabilities
 * This is critical for Windows environments with WDAC/AppLocker restrictions
 */

import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";

export const namedPipeCheck: HealthCheckModule = {
  id: "named-pipe",
  name: "Named Pipe Communication",
  description: "Checks if named pipes can be created for RPC communication",
  platforms: ["all"],
  enabled: true,
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const startTime = performance.now();
    const { logger } = context;

    try {
      // Check temp directory access
      const tempDir = os.tmpdir();
      const tempDirExists = await fs.pathExists(tempDir);

      if (!tempDirExists) {
        return {
          name: "Named Pipe Communication",
          status: "fail",
          message: `Temporary directory does not exist: ${tempDir}`,
          suggestion:
            "The system temporary directory is required for socket creation. Check system configuration.",
          duration: performance.now() - startTime,
        };
      }

      // Test write permissions in temp directory
      const testFile = path.join(tempDir, `konveyor-health-check-${Date.now()}.tmp`);
      try {
        await fs.writeFile(testFile, "test");
        await fs.remove(testFile);
      } catch (err) {
        return {
          name: "Named Pipe Communication",
          status: "fail",
          message: `Cannot write to temporary directory: ${tempDir}`,
          details: err instanceof Error ? err.message : String(err),
          suggestion:
            "Write access to the temporary directory is required for socket creation. This may be blocked by WDAC, AppLocker, or filesystem restrictions.",
          duration: performance.now() - startTime,
        };
      }

      // Check for XDG_RUNTIME_DIR on Unix systems
      let xdgInfo = "";
      if (process.platform !== "win32") {
        const xdgDir = process.env.XDG_RUNTIME_DIR;
        if (xdgDir) {
          const xdgExists = await fs.pathExists(xdgDir);
          xdgInfo = `\nXDG_RUNTIME_DIR: ${xdgDir} (${xdgExists ? "exists" : "not found"})`;
        } else {
          xdgInfo = "\nXDG_RUNTIME_DIR: Not set (will use /tmp)";
        }
      }

      // Check socket path length limit (Unix-like systems)
      let pathLengthWarning = "";
      if (process.platform !== "win32") {
        const maxPathLength = process.platform === "darwin" ? 103 : 107;
        const examplePath = path.join(
          tempDir,
          "vscode-ipc-very-long-workspace-path-name-example.sock",
        );

        if (examplePath.length > maxPathLength) {
          pathLengthWarning = `\nWarning: Temp directory path is long (${tempDir.length} chars). Socket paths are limited to ${maxPathLength} characters. Deep workspace paths may cause issues.`;
        }
      }

      // Windows-specific checks
      let windowsInfo = "";
      if (process.platform === "win32") {
        windowsInfo =
          "\nWindows: Named pipes use \\\\.\\pipe\\ namespace. WDAC/AppLocker policies may restrict pipe creation.";
      }

      return {
        name: "Named Pipe Communication",
        status: pathLengthWarning ? "warning" : "pass",
        message: "Temporary directory is accessible for socket/pipe creation",
        details: `Temp Directory: ${tempDir}${xdgInfo}${pathLengthWarning}${windowsInfo}`,
        duration: performance.now() - startTime,
      };
    } catch (err) {
      logger.error("Error checking named pipe capabilities", err);
      return {
        name: "Named Pipe Communication",
        status: "fail",
        message: "Failed to check named pipe capabilities",
        details: err instanceof Error ? err.message : String(err),
        duration: performance.now() - startTime,
      };
    }
  },
};
