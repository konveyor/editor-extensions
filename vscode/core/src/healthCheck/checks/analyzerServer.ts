/**
 * Health check for analyzer server status and connection
 */

import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import { CheckResultBuilder, withErrorHandling, formatDetails } from "../helpers";

const SERVER_STATUS_MAP: Record<string, string> = {
  stopped: "Server is stopped",
  starting: "Server is starting",
  startFailed: "Server failed to start",
  configurationNeeded: "Configuration needed",
};

export const analyzerServerCheck: HealthCheckModule = {
  id: "analyzer-server",
  name: "Analyzer Server Status",
  description: "Checks if the analyzer server is running and responsive",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { state, logger } = context;
    const builder = new CheckResultBuilder("Analyzer Server Status");

    return withErrorHandling("Analyzer Server Status", logger, async () => {
      if (!state.analyzerClient) {
        return builder.fail(
          "Analyzer client not initialized",
          undefined,
          "Extension may not be fully loaded. Try reloading the window.",
        );
      }

      const isRunning = state.analyzerClient.isServerRunning();
      const serverState = state.data.serverState;
      const canAnalyze = state.analyzerClient.canAnalyze();

      if (isRunning) {
        return builder.pass(
          "Analyzer server is running",
          formatDetails(`Server State: ${serverState}`, `Can Analyze: ${canAnalyze}`),
        );
      }

      const status = serverState === "stopped" ? "warning" : "fail";
      const message = SERVER_STATUS_MAP[serverState] || `Server state: ${serverState}`;
      const suggestion =
        serverState === "stopped"
          ? "Use 'Konveyor: Start Server' command to start the analyzer"
          : serverState === "startFailed"
            ? "Check logs for startup errors. May be related to binary permissions or named pipe issues."
            : "Wait for server to complete initialization or check configuration";

      return { ...builder[status](message, undefined, suggestion), status } as CheckResult;
    });
  },
};
