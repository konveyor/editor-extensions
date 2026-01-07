/**
 * Main health check system - orchestrates all health check modules
 */

import { HealthCheckModule, HealthCheckContext, HealthCheckReport, CheckStatus } from "./types";
import { analyzerBinaryCheck } from "./checks/analyzerBinary";
import { analyzerServerCheck } from "./checks/analyzerServer";
import { namedPipeCheck } from "./checks/namedPipe";
import { networkConfigCheck } from "./checks/networkConfig";
import { fileSystemPermissionsCheck } from "./checks/fileSystemPermissions";
import { windowsSecurityCheck } from "./checks/windowsSecurity";
import { languageProvidersCheck } from "./checks/languageProviders";
import { llmProviderCheck } from "./checks/llmProvider";
import { EXTENSION_NAME } from "../utilities/constants";
import { HealthCheckRegistry } from "../api";

/**
 * Core health check modules (non-language-specific)
 * These are automatically registered when the health check system initializes
 */
const coreHealthCheckModules: HealthCheckModule[] = [
  analyzerBinaryCheck,
  analyzerServerCheck,
  languageProvidersCheck,
  llmProviderCheck,
  namedPipeCheck,
  networkConfigCheck,
  fileSystemPermissionsCheck,
  windowsSecurityCheck,
];

/**
 * Register core health check modules with the registry
 */
export function registerCoreHealthChecks(registry: HealthCheckRegistry): void {
  coreHealthCheckModules.forEach((module) => {
    registry.registerHealthCheck(module);
  });
}

/**
 * Filter health check modules based on current platform
 */
function getApplicableModules(registry: HealthCheckRegistry): HealthCheckModule[] {
  const currentPlatform = process.platform;
  const allModules = registry.getHealthChecks();
  return allModules.filter((module) => {
    if (!module.enabled) {
      return false;
    }
    return module.platforms.includes("all") || module.platforms.includes(currentPlatform as any);
  });
}

/**
 * Determine overall status from individual check results
 */
function determineOverallStatus(results: { status: CheckStatus }[]): CheckStatus {
  if (results.some((r) => r.status === "fail")) {
    return "fail";
  }
  if (results.some((r) => r.status === "warning")) {
    return "warning";
  }
  return "pass";
}

/**
 * Extended check result that includes extension source metadata
 */
interface ExtendedCheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  details?: string;
  suggestion?: string;
  duration?: number;
  extensionSource?: string;
}

/**
 * Run all applicable health checks
 */
export async function runHealthCheck(
  context: HealthCheckContext,
  registry: HealthCheckRegistry,
): Promise<HealthCheckReport> {
  const startTime = performance.now();
  const { logger } = context;

  logger.info("Starting health check...");

  const applicableModules = getApplicableModules(registry);
  logger.info(`Running ${applicableModules.length} health checks`);

  const results: ExtendedCheckResult[] = [];

  for (const module of applicableModules) {
    logger.debug(`Running health check: ${module.name}`);
    // Track duration for each individual health check
    const checkStartTime = performance.now();
    try {
      const result = await module.check(context);
      const duration = performance.now() - checkStartTime;

      // Add extension source metadata and duration to the result
      results.push({
        ...result,
        duration,
        extensionSource: module.extensionSource,
      });
      logger.debug(`Health check completed: ${module.name} - ${result.status}`);
    } catch (error) {
      logger.error(`Health check failed: ${module.name}`, error);
      results.push({
        name: module.name,
        status: "fail" as CheckStatus,
        message: "Health check encountered an unexpected error",
        details: error instanceof Error ? error.message : String(error),
        extensionSource: module.extensionSource,
        duration: performance.now() - checkStartTime,
      });
    }
  }

  const totalDuration = performance.now() - startTime;
  const overallStatus = determineOverallStatus(results);

  logger.info(
    `Health check completed in ${totalDuration.toFixed(2)}ms - Overall status: ${overallStatus}`,
  );

  return {
    overallStatus,
    timestamp: new Date(),
    platform: {
      type: process.platform,
      version: process.version,
    },
    results,
    totalDuration,
  };
}

/**
 * Format health check report as human-readable text
 */
export function formatHealthCheckReport(report: HealthCheckReport): string {
  const lines: string[] = [];

  // Header
  lines.push("=".repeat(80));
  lines.push(`${EXTENSION_NAME} HEALTH CHECK REPORT`);
  lines.push("=".repeat(80));
  lines.push("");

  // Summary
  const statusIcon: Record<CheckStatus, string> = {
    pass: ".",
    fail: "x",
    warning: "!",
    skip: "o",
  };

  lines.push(
    `Overall Status: ${statusIcon[report.overallStatus]} ${report.overallStatus.toUpperCase()}`,
  );
  lines.push(`Timestamp: ${report.timestamp.toISOString()}`);
  lines.push(`Platform: ${report.platform.type} (Node ${report.platform.version})`);
  lines.push(
    `Duration: ${report.totalDuration.toFixed(2)}ms (${(report.totalDuration / 1000).toFixed(2)}s)`,
  );
  lines.push("");

  // Results summary
  const counts = {
    pass: report.results.filter((r) => r.status === "pass").length,
    fail: report.results.filter((r) => r.status === "fail").length,
    warning: report.results.filter((r) => r.status === "warning").length,
    skip: report.results.filter((r) => r.status === "skip").length,
  };

  lines.push("Results Summary:");
  lines.push(`  ${statusIcon.pass} Passed:  ${counts.pass}`);
  lines.push(`  ${statusIcon.fail} Failed:  ${counts.fail}`);
  lines.push(`  ${statusIcon.warning} Warning: ${counts.warning}`);
  lines.push(`  ${statusIcon.skip} Skipped: ${counts.skip}`);
  lines.push("");

  // Group results by extension source
  const resultsByExtension = new Map<string, ExtendedCheckResult[]>();
  const extResults = report.results as ExtendedCheckResult[];

  for (const result of extResults) {
    const source = result.extensionSource || "core";
    if (!resultsByExtension.has(source)) {
      resultsByExtension.set(source, []);
    }
    resultsByExtension.get(source)!.push(result);
  }

  // Sort extension sources: "core" first, then alphabetically
  const sortedSources = Array.from(resultsByExtension.keys()).sort((a, b) => {
    if (a === "core") {
      return -1;
    }
    if (b === "core") {
      return 1;
    }
    return a.localeCompare(b);
  });

  // Format results by extension
  for (const source of sortedSources) {
    const results = resultsByExtension.get(source)!;

    lines.push("-".repeat(80));
    const sectionTitle =
      source === "core" ? "CORE EXTENSION CHECKS" : `${source.toUpperCase()} EXTENSION CHECKS`;
    lines.push(sectionTitle);
    lines.push("-".repeat(80));
    lines.push("");

    for (const result of results) {
      const icon = statusIcon[result.status];
      lines.push(`${icon} ${result.name.toUpperCase()}`);
      lines.push(`  Status: ${result.status.toUpperCase()}`);
      lines.push(`  Message: ${result.message}`);

      if (result.details) {
        lines.push(`  Details:`);
        const detailLines = result.details.split("\n");
        for (const line of detailLines) {
          lines.push(`    ${line}`);
        }
      }

      if (result.suggestion) {
        lines.push(`  Suggestion: ${result.suggestion}`);
      }

      if (result.duration !== undefined) {
        lines.push(`  Duration: ${result.duration.toFixed(2)}ms`);
      }

      lines.push("");
    }
  }

  lines.push("=".repeat(80));
  lines.push("END OF REPORT");
  lines.push("=".repeat(80));

  return lines.join("\n");
}

/**
 * Get all registered health check modules (for testing/debugging)
 */
export function getAllHealthCheckModules(registry: HealthCheckRegistry): HealthCheckModule[] {
  return registry.getHealthChecks();
}

/**
 * Get applicable health check modules for current platform
 */
export function getApplicableHealthCheckModules(
  registry: HealthCheckRegistry,
): HealthCheckModule[] {
  return getApplicableModules(registry);
}
