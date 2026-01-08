/**
 * Helper utilities for health check implementations
 * Provides common patterns to reduce code duplication
 */

import { CheckResult, CheckStatus } from "./types";
import type { Logger } from "winston";

/**
 * Builder class for creating CheckResult objects with less boilerplate
 */
export class CheckResultBuilder {
  constructor(private readonly checkName: string) {}

  pass(message: string, details?: string): CheckResult {
    return {
      name: this.checkName,
      status: "pass" as CheckStatus,
      message,
      ...(details && { details }),
    };
  }

  fail(message: string, details?: string, suggestion?: string): CheckResult {
    return {
      name: this.checkName,
      status: "fail" as CheckStatus,
      message,
      ...(details && { details }),
      ...(suggestion && { suggestion }),
    };
  }

  warning(message: string, details?: string, suggestion?: string): CheckResult {
    return {
      name: this.checkName,
      status: "warning" as CheckStatus,
      message,
      ...(details && { details }),
      ...(suggestion && { suggestion }),
    };
  }

  skip(reason: string): CheckResult {
    return {
      name: this.checkName,
      status: "skip" as CheckStatus,
      message: reason,
    };
  }
}

/**
 * Wraps a health check function with standard error handling
 * Catches unexpected errors and returns a consistent fail result
 */
export async function withErrorHandling(
  checkName: string,
  logger: Logger,
  fn: () => Promise<CheckResult>,
): Promise<CheckResult> {
  try {
    return await fn();
  } catch (err) {
    logger.error(`Error checking ${checkName}`, err);
    return {
      name: checkName,
      status: "fail" as CheckStatus,
      message: `Failed to check ${checkName}`,
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Returns a skip result if the current platform doesn't match the required platform
 * Returns null if the platform matches (check should proceed)
 */
export function skipIfNotPlatform(
  checkName: string,
  requiredPlatform: NodeJS.Platform,
  currentPlatform: NodeJS.Platform = process.platform,
): CheckResult | null {
  if (currentPlatform !== requiredPlatform) {
    return {
      name: checkName,
      status: "skip" as CheckStatus,
      message: `Not applicable on ${currentPlatform} platform`,
    };
  }
  return null;
}

/**
 * Helper to format error messages from Error objects or other values
 */
export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Helper to create a details string from multiple lines
 */
export function formatDetails(...lines: (string | undefined)[]): string {
  return lines.filter(Boolean).join("\n");
}
