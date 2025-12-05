/**
 * Health check for Java Language Server (Red Hat Java extension)
 */

import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";

export const javaExtensionCheck: HealthCheckModule = {
  id: "java-extension",
  name: "Java Language Server",
  description: "Checks if the Red Hat Java extension is installed and active",
  platforms: ["all"],
  enabled: true,
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const startTime = performance.now();
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
          duration: performance.now() - startTime,
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
          duration: performance.now() - startTime,
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
        duration: performance.now() - startTime,
      };
    } catch (err) {
      logger.error("Error checking Java extension", err);
      return {
        name: "Java Language Server",
        status: "fail",
        message: "Failed to check Java extension status",
        details: err instanceof Error ? err.message : String(err),
        duration: performance.now() - startTime,
      };
    }
  },
};
