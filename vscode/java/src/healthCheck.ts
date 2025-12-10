/**
 * Health checks for Java extension
 * Each extension can register multiple health checks
 */

import { HealthCheckModule, CheckResult, HealthCheckContext } from "@editor-extensions/shared";
import { execFile } from "child_process";
import { promisify } from "util";

/**
 * Check if a command is available on the system
 */
async function checkCommand(
  command: string,
  versionFlag = "-version",
): Promise<{ available: boolean; version?: string; error?: string }> {
  const commandName = process.platform === "win32" && command === "mvn" ? "mvn.cmd" : command;
  const versionFlags = [versionFlag, "-version", "--version", "-v"];
  const uniqueFlags = [...new Set(versionFlags)];

  for (const flag of uniqueFlags) {
    try {
      const { stdout, stderr } = await promisify(execFile)(commandName, [flag]);
      const output = stdout || stderr;
      return { available: true, version: output.split("\n")[0].trim() };
    } catch {
      try {
        const { stdout, stderr } = await promisify(execFile)(commandName, [flag], { shell: true });
        const output = stdout || stderr;
        return { available: true, version: output.split("\n")[0].trim() };
      } catch (error) {
        continue;
      }
    }
  }

  return { available: false, error: `Command '${command}' not found in PATH` };
}

/**
 * Check if Red Hat Java extension is installed and active
 */
const javaExtensionCheck: HealthCheckModule = {
  id: "java-extension",
  name: "Java Language Server",
  description: "Checks if the Red Hat Java extension is installed and active",
  platforms: ["all"],
  enabled: true,
  extensionSource: "java",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { vscode, logger } = context;

    try {
      const javaExtension = vscode.extensions.getExtension("redhat.java");

      if (!javaExtension) {
        return {
          name: "Java Language Server",
          status: "warning",
          message: "Red Hat Java extension is not installed",
          details:
            "The extension is required for Java project analysis. Without it, Java analysis results will be degraded.",
          suggestion: "Install the 'Language Support for Java(TM) by Red Hat' extension",
        };
      }

      const isActive = javaExtension.isActive;
      const version = javaExtension.packageJSON.version;

      if (!isActive) {
        return {
          name: "Java Language Server",
          status: "warning",
          message: "Red Hat Java extension is installed but not active",
          details: `Version: ${version}\nThe extension may still be loading or requires workspace activation.`,
          suggestion: "Open a Java file to activate the extension",
        };
      }

      // Try to execute a Java command to verify it's working
      let javaCommandWorks = false;
      try {
        await vscode.commands.executeCommand("java.project.getAll");
        javaCommandWorks = true;
      } catch (err) {
        // Command may fail if no Java projects are open
        logger.debug("Java command test failed (expected if no Java projects open)", err);
      }

      return {
        name: "Java Language Server",
        status: "pass",
        message: "Red Hat Java extension is installed and active",
        details: `Version: ${version}\nActive: ${isActive}\nCommand Test: ${javaCommandWorks ? "Success" : "N/A (no Java projects detected)"}`,
      };
    } catch (err) {
      logger.error("Error checking Java extension", err);
      return {
        name: "Java Language Server",
        status: "fail",
        message: "Failed to check Java extension status",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Check if Java Runtime is installed and available
 */
const javaRuntimeCheck: HealthCheckModule = {
  id: "java-runtime",
  name: "Java Runtime",
  description: "Checks if Java (JDK/JRE) is installed and available in PATH",
  platforms: ["all"],
  enabled: true,
  extensionSource: "java",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { logger } = context;

    try {
      const result = await checkCommand("java");

      if (!result.available) {
        return {
          name: "Java Runtime",
          status: "fail",
          message: "Java is not installed or not available in PATH",
          details: result.error || "Java runtime is required for the Konveyor analyzer to function",
          suggestion:
            "Install a Java Development Kit (JDK) or Java Runtime Environment (JRE) and ensure it's in your PATH",
        };
      }

      return {
        name: "Java Runtime",
        status: "pass",
        message: "Java runtime is installed and available",
        details: result.version || "Java command is available",
      };
    } catch (err) {
      logger.error("Error checking Java runtime", err);
      return {
        name: "Java Runtime",
        status: "fail",
        message: "Failed to check Java runtime",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Check if Maven is installed and available
 */
const mavenCheck: HealthCheckModule = {
  id: "maven",
  name: "Maven Build Tool",
  description: "Checks if Apache Maven is installed and available in PATH",
  platforms: ["all"],
  enabled: true,
  extensionSource: "java",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { logger } = context;

    try {
      const result = await checkCommand("mvn");

      if (!result.available) {
        return {
          name: "Maven Build Tool",
          status: "warning",
          message: "Maven is not installed or not available in PATH",
          details:
            result.error ||
            "Maven is required for analyzing Java projects that use Maven as their build tool",
          suggestion:
            "Install Apache Maven and ensure it's in your PATH. This is only required for Maven-based Java projects.",
        };
      }

      return {
        name: "Maven Build Tool",
        status: "pass",
        message: "Maven is installed and available",
        details: result.version || "Maven command is available",
      };
    } catch (err) {
      logger.error("Error checking Maven", err);
      return {
        name: "Maven Build Tool",
        status: "fail",
        message: "Failed to check Maven",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * All Java-specific health checks
 * Add new health checks to this array
 */
export const javaHealthChecks: HealthCheckModule[] = [
  javaExtensionCheck,
  javaRuntimeCheck,
  mavenCheck,
];
