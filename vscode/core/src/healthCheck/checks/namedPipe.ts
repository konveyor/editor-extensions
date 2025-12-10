/**
 * Health check for named pipe communication capabilities
 * This is critical for Windows environments with WDAC/AppLocker restrictions
 */

import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import { CheckResultBuilder, withErrorHandling, formatError, formatDetails } from "../helpers";

async function getXdgInfo(): Promise<string | undefined> {
  if (process.platform === "win32") {
    return undefined;
  }

  const xdgDir = process.env.XDG_RUNTIME_DIR;
  if (xdgDir) {
    const exists = await fs.pathExists(xdgDir);
    return `XDG_RUNTIME_DIR: ${xdgDir} (${exists ? "exists" : "not found"})`;
  }
  return "XDG_RUNTIME_DIR: Not set (will use /tmp)";
}

function getPathLengthWarning(tempDir: string): string | undefined {
  if (process.platform === "win32") {
    return undefined;
  }

  const maxPathLength = process.platform === "darwin" ? 103 : 107;
  const examplePath = path.join(tempDir, "vscode-ipc-very-long-workspace-path-name-example.sock");

  if (examplePath.length > maxPathLength) {
    return `Warning: Temp directory path is long (${tempDir.length} chars). Socket paths are limited to ${maxPathLength} characters. Deep workspace paths may cause issues.`;
  }
  return undefined;
}

export const namedPipeCheck: HealthCheckModule = {
  id: "named-pipe",
  name: "Named Pipe Communication",
  description: "Checks if named pipes can be created for RPC communication",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { logger } = context;
    const builder = new CheckResultBuilder("Named Pipe Communication");

    return withErrorHandling("Named Pipe Communication", logger, async () => {
      const tempDir = os.tmpdir();

      if (!(await fs.pathExists(tempDir))) {
        return builder.fail(
          `Temporary directory does not exist: ${tempDir}`,
          undefined,
          "The system temporary directory is required for socket creation. Check system configuration.",
        );
      }

      // Test write permissions
      const testFile = path.join(tempDir, `konveyor-health-check-${Date.now()}.tmp`);
      try {
        await fs.writeFile(testFile, "test");
        await fs.remove(testFile);
      } catch (err) {
        return builder.fail(
          `Cannot write to temporary directory: ${tempDir}`,
          formatError(err),
          "Write access to the temporary directory is required for socket creation. This may be blocked by WDAC, AppLocker, or filesystem restrictions.",
        );
      }

      // Gather platform-specific information
      const xdgInfo = await getXdgInfo();
      const pathWarning = getPathLengthWarning(tempDir);
      const windowsInfo =
        process.platform === "win32"
          ? "Windows: Named pipes use \\\\.\\pipe\\ namespace. WDAC/AppLocker policies may restrict pipe creation."
          : undefined;

      const details = formatDetails(
        `Temp Directory: ${tempDir}`,
        xdgInfo,
        pathWarning,
        windowsInfo,
      );

      return pathWarning
        ? builder.warning("Temporary directory is accessible for socket/pipe creation", details)
        : builder.pass("Temporary directory is accessible for socket/pipe creation", details);
    });
  },
};
