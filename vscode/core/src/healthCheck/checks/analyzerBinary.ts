/**
 * Health check for analyzer binary availability and permissions
 */

import * as fs from "fs-extra";
import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import { buildAssetPaths } from "../../client/paths";
import { getConfigAnalyzerPath } from "../../utilities";

export const analyzerBinaryCheck: HealthCheckModule = {
  id: "analyzer-binary",
  name: "Analyzer Binary",
  description: "Checks if the analyzer binary exists and is executable",
  platforms: ["all"],
  enabled: true,
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const startTime = performance.now();
    const { logger, state } = context;

    try {
      // Check if custom analyzer path is configured
      const customPath = getConfigAnalyzerPath();
      const assetPaths = buildAssetPaths(state.extensionContext);
      const analyzerPath = customPath || assetPaths.kaiAnalyzer;

      // Check if binary exists
      const exists = await fs.pathExists(analyzerPath);
      if (!exists) {
        return {
          name: "Analyzer Binary",
          status: "fail",
          message: `Analyzer binary not found at: ${analyzerPath}`,
          suggestion:
            "The binary may need to be downloaded. Try running the analyzer or manually specify a path using 'Override Analyzer Binary' command.",
          duration: performance.now() - startTime,
        };
      }

      // Check if binary is executable (Unix-like systems)
      if (process.platform !== "win32") {
        try {
          await fs.access(analyzerPath, fs.constants.X_OK);
        } catch (err) {
          return {
            name: "Analyzer Binary",
            status: "fail",
            message: `Analyzer binary exists but is not executable: ${analyzerPath}`,
            details: err instanceof Error ? err.message : String(err),
            suggestion: `Run: chmod +x "${analyzerPath}"`,
            duration: performance.now() - startTime,
          };
        }
      }

      // Check file stats
      const stats = await fs.stat(analyzerPath);
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

      return {
        name: "Analyzer Binary",
        status: "pass",
        message: `Analyzer binary found and accessible`,
        details: `Path: ${analyzerPath}\nSize: ${sizeInMB} MB\nModified: ${stats.mtime.toISOString()}`,
        duration: performance.now() - startTime,
      };
    } catch (err) {
      logger.error("Error checking analyzer binary", err);
      return {
        name: "Analyzer Binary",
        status: "fail",
        message: "Failed to check analyzer binary",
        details: err instanceof Error ? err.message : String(err),
        duration: performance.now() - startTime,
      };
    }
  },
};
