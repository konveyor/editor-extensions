/**
 * Windows-specific health checks for WDAC/AppLocker restrictions
 */

import { exec } from "child_process";
import { promisify } from "util";
import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";

const execAsync = promisify(exec);

/**
 * Check if PowerShell is available on the system
 */
async function isPowerShellAvailable(): Promise<boolean> {
  try {
    await execAsync("powershell -Command exit", { timeout: 3000 });
    return true;
  } catch {
    return false;
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

    if (process.platform !== "win32") {
      return {
        name: "Windows Security Policies",
        status: "skip",
        message: "Not applicable on non-Windows platform",
      };
    }

    try {
      // First check if PowerShell is available
      const hasPowerShell = await isPowerShellAvailable();
      if (!hasPowerShell) {
        return {
          name: "Windows Security Policies",
          status: "warning",
          message: "PowerShell not available",
          details:
            "PowerShell is required to check Windows event logs for AppLocker/WDAC events. The extension may still function, but diagnostics are limited.",
          suggestion:
            "Install PowerShell to enable detailed Windows security diagnostics. This is not critical for normal operation.",
        };
      }

      const warnings: string[] = [];
      let details = "PowerShell: Available\n";

      // Check for AppLocker events (last 24 hours)
      try {
        const appLockerQuery = `Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-AppLocker/EXE and DLL'; StartTime=(Get-Date).AddDays(-1)} -MaxEvents 10 -ErrorAction SilentlyContinue | Select-Object -First 10 | Format-List TimeCreated,Id,Message`;

        const { stdout: appLockerOutput } = await execAsync(
          `powershell -Command "${appLockerQuery}"`,
          { timeout: 5000 },
        );

        if (appLockerOutput && appLockerOutput.trim().length > 0) {
          warnings.push(
            "AppLocker events detected in the last 24 hours. This may indicate blocked executables.",
          );
          details += `\nRecent AppLocker Events:\n${appLockerOutput.substring(0, 500)}${appLockerOutput.length > 500 ? "..." : ""}\n`;
        } else {
          details += "\nAppLocker Events: None found in last 24 hours\n";
        }
      } catch (err) {
        // AppLocker may not be configured or accessible
        details += "\nAppLocker Events: Unable to query (may not be configured)\n";
        logger.debug("AppLocker query failed", err);
      }

      // Check for Code Integrity (WDAC) events (last 24 hours)
      try {
        const wdacQuery = `Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-CodeIntegrity/Operational'; StartTime=(Get-Date).AddDays(-1)} -MaxEvents 10 -ErrorAction SilentlyContinue | Select-Object -First 10 | Format-List TimeCreated,Id,Message`;

        const { stdout: wdacOutput } = await execAsync(`powershell -Command "${wdacQuery}"`, {
          timeout: 5000,
        });

        if (wdacOutput && wdacOutput.trim().length > 0) {
          warnings.push(
            "WDAC (Code Integrity) events detected. This may indicate blocked binaries or policy violations.",
          );
          details += `\nRecent WDAC Events:\n${wdacOutput.substring(0, 500)}${wdacOutput.length > 500 ? "..." : ""}\n`;
        } else {
          details += "\nWDAC Events: None found in last 24 hours\n";
        }
      } catch (err) {
        // WDAC may not be configured or accessible
        details += "\nWDAC Events: Unable to query (may not be configured)\n";
        logger.debug("WDAC query failed", err);
      }

      // Check if running with Administrator privileges
      try {
        const { stdout: adminCheck } = await execAsync(
          `powershell -Command "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"`,
          { timeout: 3000 },
        );

        const isAdmin = adminCheck.trim().toLowerCase() === "true";
        details += `\nRunning as Administrator: ${isAdmin ? "Yes" : "No"}\n`;

        if (!isAdmin) {
          details += "Note: Running as non-administrator is typical for enterprise environments.\n";
        }
      } catch (err) {
        logger.debug("Admin check failed", err);
      }

      if (warnings.length > 0) {
        return {
          name: "Windows Security Policies",
          status: "warning",
          message: `Detected ${warnings.length} potential security restriction(s)`,
          details: `${warnings.map((w) => `! ${w}`).join("\n")}\n${details}`,
          suggestion:
            "Review Windows Event Viewer for detailed AppLocker/WDAC logs. If the analyzer fails to start, the binary may need to be whitelisted in your security policies.",
        };
      }

      return {
        name: "Windows Security Policies",
        status: "pass",
        message: "No recent AppLocker or WDAC events detected",
        details,
      };
    } catch (err) {
      logger.error("Error checking Windows security policies", err);
      return {
        name: "Windows Security Policies",
        status: "warning",
        message: "Unable to fully check Windows security policies",
        details: `${err instanceof Error ? err.message : String(err)}\nThis may be expected if you don't have permissions to view event logs.`,
      };
    }
  },
};
