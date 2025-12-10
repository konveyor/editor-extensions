/**
 * Health check for analyzer server status and connection
 */

import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";

export const analyzerServerCheck: HealthCheckModule = {
  id: "analyzer-server",
  name: "Analyzer Server Status",
  description: "Checks if the analyzer server is running and responsive",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { state, logger } = context;

    try {
      const analyzerClient = state.analyzerClient;
      if (!analyzerClient) {
        return {
          name: "Analyzer Server Status",
          status: "fail",
          message: "Analyzer client not initialized",
          suggestion: "Extension may not be fully loaded. Try reloading the window.",
        };
      }

      const isRunning = analyzerClient.isServerRunning();
      const serverState = state.data.serverState;
      const canAnalyze = analyzerClient.canAnalyze();

      if (isRunning) {
        return {
          name: "Analyzer Server Status",
          status: "pass",
          message: "Analyzer server is running",
          details: `Server State: ${serverState}\nCan Analyze: ${canAnalyze}`,
        };
      } else {
        const statusMap: Record<string, string> = {
          stopped: "Server is stopped",
          starting: "Server is starting",
          startFailed: "Server failed to start",
          configurationNeeded: "Configuration needed",
        };

        return {
          name: "Analyzer Server Status",
          status: serverState === "stopped" ? "warning" : "fail",
          message: statusMap[serverState] || `Server state: ${serverState}`,
          suggestion:
            serverState === "stopped"
              ? "Use 'Konveyor: Start Server' command to start the analyzer"
              : serverState === "startFailed"
                ? "Check logs for startup errors. May be related to binary permissions or named pipe issues."
                : "Wait for server to complete initialization or check configuration",
        };
      }
    } catch (err) {
      logger.error("Error checking analyzer server status", err);
      return {
        name: "Analyzer Server Status",
        status: "fail",
        message: "Failed to check analyzer server status",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
