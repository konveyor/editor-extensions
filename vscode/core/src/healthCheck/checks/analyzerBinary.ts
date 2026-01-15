/**
 * Health check for analyzer binary availability and permissions
 */

import * as fs from "fs-extra";
import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import { buildAssetPaths } from "../../client/paths";
import { getConfigAnalyzerPath } from "../../utilities";
import { CheckResultBuilder, withErrorHandling, formatError, formatDetails } from "../helpers";

export const analyzerBinaryCheck: HealthCheckModule = {
  id: "analyzer-binary",
  name: "Analyzer Binary",
  description: "Checks if the analyzer binary exists and is executable",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { logger, state } = context;
    const builder = new CheckResultBuilder("Analyzer Binary");

    return withErrorHandling("Analyzer Binary", logger, async () => {
      const customPath = getConfigAnalyzerPath();
      const assetPaths = buildAssetPaths(state.extensionContext);
      const analyzerPath = customPath || assetPaths.kaiAnalyzer;

      // Check if binary exists
      if (!(await fs.pathExists(analyzerPath))) {
        return builder.fail(
          `Analyzer binary not found at: ${analyzerPath}`,
          undefined,
          "The binary may need to be downloaded. Try running the analyzer or manually specify a path using 'Override Analyzer Binary' command.",
        );
      }

      // Check if binary is executable (Unix-like systems)
      if (process.platform !== "win32") {
        try {
          await fs.access(analyzerPath, fs.constants.X_OK);
        } catch (err) {
          return builder.fail(
            `Analyzer binary exists but is not executable: ${analyzerPath}`,
            formatError(err),
            `Run: chmod +x "${analyzerPath}"`,
          );
        }
      }

      // Check file stats
      const stats = await fs.stat(analyzerPath);
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

      return builder.pass(
        "Analyzer binary found and accessible",
        formatDetails(
          `Path: ${analyzerPath}`,
          `Size: ${sizeInMB} MB`,
          `Modified: ${stats.mtime.toISOString()}`,
        ),
      );
    });
  },
};
