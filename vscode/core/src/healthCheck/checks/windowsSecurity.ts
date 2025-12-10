/**
 * Windows-specific health checks for WDAC/AppLocker restrictions
 */

import { exec } from "child_process";
import { promisify } from "util";
import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import { CheckResultBuilder, skipIfNotPlatform, formatDetails } from "../helpers";

const execAsync = promisify(exec);

async function isPowerShellAvailable(): Promise<boolean> {
  try {
    await execAsync("powershell -Command exit", { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

interface EventLogResult {
  hasEvents: boolean;
  output?: string;
}

async function queryEventLog(logName: string, logger: any): Promise<EventLogResult> {
  try {
    const query = `Get-WinEvent -FilterHashtable @{LogName='${logName}'; StartTime=(Get-Date).AddDays(-1)} -MaxEvents 10 -ErrorAction SilentlyContinue | Select-Object -First 10 | Format-List TimeCreated,Id,Message`;

    const { stdout } = await execAsync(`powershell -Command "${query}"`, {
      timeout: 5000,
    });

    if (stdout && stdout.trim().length > 0) {
      return {
        hasEvents: true,
        output: stdout.substring(0, 500) + (stdout.length > 500 ? "..." : ""),
      };
    }

    return { hasEvents: false };
  } catch (err) {
    logger.debug(`Event log query failed for ${logName}`, err);
    return { hasEvents: false };
  }
}

export const windowsSecurityCheck: HealthCheckModule = {
  id: "windows-security",
  name: "Windows Security Policies",
  description: "Checks for Windows WDAC/AppLocker restrictions and related event logs",
  platforms: ["win32"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { logger } = context;
    const builder = new CheckResultBuilder("Windows Security Policies");

    const skipResult = skipIfNotPlatform("Windows Security Policies", "win32");
    if (skipResult) {
      return skipResult;
    }

    try {
      const hasPowerShell = await isPowerShellAvailable();
      if (!hasPowerShell) {
        return builder.warning(
          "PowerShell not available",
          "PowerShell is required to check Windows event logs for AppLocker/WDAC events. " +
            "The extension may still function, but diagnostics are limited.",
          "Install PowerShell to enable detailed Windows security diagnostics. This is not critical for normal operation.",
        );
      }

      const warnings: string[] = [];
      const detailsSections: string[] = ["PowerShell: Available"];

      // Check AppLocker events
      const appLockerResult = await queryEventLog(
        "Microsoft-Windows-AppLocker/EXE and DLL",
        logger,
      );

      if (appLockerResult.hasEvents) {
        warnings.push(
          "AppLocker events detected in the last 24 hours. This may indicate blocked executables.",
        );
        detailsSections.push(`Recent AppLocker Events:\n${appLockerResult.output}`);
      } else {
        detailsSections.push("AppLocker Events: None found in last 24 hours");
      }

      // Check WDAC events
      const wdacResult = await queryEventLog("Microsoft-Windows-CodeIntegrity/Operational", logger);

      if (wdacResult.hasEvents) {
        warnings.push(
          "WDAC (Code Integrity) events detected. This may indicate blocked binaries or policy violations.",
        );
        detailsSections.push(`Recent WDAC Events:\n${wdacResult.output}`);
      } else {
        detailsSections.push("WDAC Events: None found in last 24 hours");
      }

      // Check administrator privileges
      try {
        const { stdout: adminCheck } = await execAsync(
          `powershell -Command "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"`,
          { timeout: 3000 },
        );

        const isAdmin = adminCheck.trim().toLowerCase() === "true";
        detailsSections.push(`Running as Administrator: ${isAdmin ? "Yes" : "No"}`);

        if (!isAdmin) {
          detailsSections.push(
            "Note: Running as non-administrator is typical for enterprise environments.",
          );
        }
      } catch (err) {
        logger.debug("Admin check failed", err);
      }

      const details = formatDetails(...detailsSections);

      if (warnings.length > 0) {
        const warningList = warnings.map((w) => `! ${w}`).join("\n");
        return builder.warning(
          `Detected ${warnings.length} potential security restriction(s)`,
          `${warningList}\n${details}`,
          "Review Windows Event Viewer for detailed AppLocker/WDAC logs. If the analyzer fails to start, the binary may need to be whitelisted in your security policies.",
        );
      }

      return builder.pass("No recent AppLocker or WDAC events detected", details);
    } catch (err) {
      logger.error("Error checking Windows security policies", err);
      return builder.warning(
        "Unable to fully check Windows security policies",
        `${err instanceof Error ? err.message : String(err)}\nThis may be expected if you don't have permissions to view event logs.`,
      );
    }
  },
};
