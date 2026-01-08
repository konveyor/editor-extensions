/**
 * Health checks for Java extension
 * Each extension can register multiple health checks
 */

import {
  HealthCheckModule,
  CheckResult,
  HealthCheckContext,
  CheckResultBuilder,
  withErrorHandling,
  formatDetails,
} from "@editor-extensions/shared";
import { execFile } from "child_process";
import { promisify } from "util";

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

const javaExtensionCheck: HealthCheckModule = {
  id: "java-extension",
  name: "Java Language Server",
  description: "Checks if the Red Hat Java extension is installed and active",
  platforms: ["all"],
  enabled: true,
  extensionSource: "java",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { vscode, logger } = context;
    const builder = new CheckResultBuilder("Java Language Server");

    return withErrorHandling("Java Language Server", logger, async () => {
      const javaExtension = vscode.extensions.getExtension("redhat.java");

      if (!javaExtension) {
        return builder.warning(
          "Red Hat Java extension is not installed",
          "The extension is required for Java project analysis. Without it, Java analysis results will be degraded.",
          "Install the 'Language Support for Java(TM) by Red Hat' extension",
        );
      }

      const isActive = javaExtension.isActive;
      const version = javaExtension.packageJSON.version;

      if (!isActive) {
        return builder.warning(
          "Red Hat Java extension is installed but not active",
          `Version: ${version}\nThe extension may still be loading or requires workspace activation.`,
          "Open a Java file to activate the extension",
        );
      }

      let javaCommandWorks = false;
      try {
        await vscode.commands.executeCommand("java.project.getAll");
        javaCommandWorks = true;
      } catch (err) {
        logger.debug("Java command test failed (expected if no Java projects open)", err);
      }

      const details = formatDetails(
        `Version: ${version}`,
        `Active: ${isActive}`,
        `Command Test: ${javaCommandWorks ? "Success" : "N/A (no Java projects detected)"}`,
      );

      return builder.pass("Red Hat Java extension is installed and active", details);
    });
  },
};

const javaRuntimeCheck: HealthCheckModule = {
  id: "java-runtime",
  name: "Java Runtime",
  description: "Checks if Java (JDK/JRE) is installed and available in PATH",
  platforms: ["all"],
  enabled: true,
  extensionSource: "java",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { logger } = context;
    const builder = new CheckResultBuilder("Java Runtime");

    return withErrorHandling("Java Runtime", logger, async () => {
      const result = await checkCommand("java");

      if (!result.available) {
        return builder.fail(
          "Java is not installed or not available in PATH",
          result.error || "Java runtime is required for the Konveyor analyzer to function",
          "Install a Java Development Kit (JDK) or Java Runtime Environment (JRE) and ensure it's in your PATH",
        );
      }

      return builder.pass(
        "Java runtime is installed and available",
        result.version || "Java command is available",
      );
    });
  },
};

const mavenCheck: HealthCheckModule = {
  id: "maven",
  name: "Maven Build Tool",
  description: "Checks if Apache Maven is installed and available in PATH",
  platforms: ["all"],
  enabled: true,
  extensionSource: "java",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { logger } = context;
    const builder = new CheckResultBuilder("Maven Build Tool");

    return withErrorHandling("Maven Build Tool", logger, async () => {
      const result = await checkCommand("mvn");

      if (!result.available) {
        return builder.warning(
          "Maven is not installed or not available in PATH",
          result.error ||
            "Maven is required for analyzing Java projects that use Maven as their build tool",
          "Install Apache Maven and ensure it's in your PATH. This is only required for Maven-based Java projects.",
        );
      }

      return builder.pass(
        "Maven is installed and available",
        result.version || "Maven command is available",
      );
    });
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
