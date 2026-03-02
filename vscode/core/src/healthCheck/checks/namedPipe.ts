/**
 * Health check for named pipe communication capabilities
 * This is critical for Windows environments with WDAC/AppLocker restrictions
 */

import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { generateSafePipeName } from "@editor-extensions/shared";
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
  return "XDG_RUNTIME_DIR: Not set";
}

function getPathLengthInfo(): string | undefined {
  if (process.platform === "win32") {
    return undefined;
  }

  const maxPathLength = process.platform === "darwin" ? 103 : 107;

  try {
    const testPath = generateSafePipeName();
    return `Socket path length: ${testPath.length}/${maxPathLength} chars (using /tmp)`;
  } catch (err) {
    return `Warning: Socket path generation failed: ${err instanceof Error ? err.message : String(err)}`;
  }
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
      // Verify /tmp is accessible (used for socket paths on Unix)
      const socketDir = process.platform === "win32" ? os.tmpdir() : "/tmp";

      if (!(await fs.pathExists(socketDir))) {
        return builder.fail(
          `Socket directory does not exist: ${socketDir}`,
          undefined,
          "The socket directory is required for IPC communication. Check system configuration.",
        );
      }

      // Test write permissions
      const testFile = path.join(socketDir, `konveyor-health-check-${Date.now()}.tmp`);
      try {
        await fs.writeFile(testFile, "test");
        await fs.remove(testFile);
      } catch (err) {
        return builder.fail(
          `Cannot write to socket directory: ${socketDir}`,
          formatError(err),
          "Write access to the socket directory is required for IPC communication. This may be blocked by WDAC, AppLocker, or filesystem restrictions.",
        );
      }

      // Gather platform-specific information
      const xdgInfo = await getXdgInfo();
      const pathInfo = getPathLengthInfo();
      const windowsInfo =
        process.platform === "win32"
          ? "Windows: Named pipes use \\\\.\\pipe\\ namespace. WDAC/AppLocker policies may restrict pipe creation."
          : undefined;

      const details = formatDetails(
        `Socket Directory: ${socketDir}`,
        `System Temp Directory: ${os.tmpdir()}`,
        xdgInfo,
        pathInfo,
        windowsInfo,
      );

      return builder.pass("Socket directory is accessible for IPC communication", details);
    });
  },
};
