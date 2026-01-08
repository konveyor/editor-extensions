/**
 * Shared utility functions for health checks
 * Can be used by both core and language extension health checks
 */

import type { CheckResult } from "./api.js";

/**
 * Builder class for creating CheckResult objects with consistent formatting
 */
export class CheckResultBuilder {
  constructor(private readonly checkName: string) {}

  pass(message: string, details?: string): CheckResult {
    return {
      name: this.checkName,
      status: "pass",
      message,
      details,
    };
  }

  fail(message: string, details?: string, suggestion?: string): CheckResult {
    return {
      name: this.checkName,
      status: "fail",
      message,
      details,
      suggestion,
    };
  }

  warning(message: string, details?: string, suggestion?: string): CheckResult {
    return {
      name: this.checkName,
      status: "warning",
      message,
      details,
      suggestion,
    };
  }

  skip(reason: string): CheckResult {
    return {
      name: this.checkName,
      status: "skip",
      message: reason,
    };
  }
}

/**
 * Wraps a health check function with automatic error handling
 */
export async function withErrorHandling(
  checkName: string,
  logger: any,
  fn: () => Promise<CheckResult>,
): Promise<CheckResult> {
  try {
    return await fn();
  } catch (err) {
    logger.error(`Error during health check: ${checkName}`, err);
    return {
      name: checkName,
      status: "fail",
      message: `Failed to check ${checkName}`,
      details: formatError(err),
    };
  }
}

/**
 * Checks if the current platform matches the required platform
 * Returns a skip result if it doesn't match, null if it does
 */
export function skipIfNotPlatform(
  checkName: string,
  requiredPlatform: NodeJS.Platform,
  currentPlatform: NodeJS.Platform = process.platform,
): CheckResult | null {
  if (currentPlatform !== requiredPlatform) {
    return {
      name: checkName,
      status: "skip",
      message: `Not applicable on ${currentPlatform} platform`,
    };
  }
  return null;
}

/**
 * Formats an unknown error into a string
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Combines multiple strings into a formatted details string,
 * filtering out undefined values
 */
export function formatDetails(...lines: (string | undefined)[]): string {
  return lines.filter((line): line is string => line !== undefined).join("\n");
}
