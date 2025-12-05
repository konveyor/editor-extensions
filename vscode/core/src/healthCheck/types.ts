/**
 * Types for the Health Check system
 */

export type CheckStatus = "pass" | "fail" | "warning" | "skip";
export type Platform = "win32" | "darwin" | "linux" | "all";

export interface CheckResult {
  /** Name of the check */
  name: string;
  /** Status of the check */
  status: CheckStatus;
  /** Detailed message about the check result */
  message: string;
  /** Optional error or additional details */
  details?: string;
  /** Optional suggestions for fixing issues */
  suggestion?: string;
  /** Duration of the check in milliseconds */
  duration?: number;
}

export interface HealthCheckModule {
  /** Unique identifier for this check */
  id: string;
  /** Display name for this check */
  name: string;
  /** Description of what this check does */
  description: string;
  /** Platforms this check runs on */
  platforms: Platform[];
  /** Whether this check is enabled by default */
  enabled: boolean;
  /** Function that performs the health check */
  check: (context: HealthCheckContext) => Promise<CheckResult>;
}

export interface HealthCheckContext {
  logger: any;
  state: any;
  vscode: typeof import("vscode");
}

export interface HealthCheckReport {
  /** Overall status of the health check */
  overallStatus: CheckStatus;
  /** Timestamp when the health check was run */
  timestamp: Date;
  /** Platform information */
  platform: {
    type: NodeJS.Platform;
    version: string;
  };
  /** Individual check results */
  results: CheckResult[];
  /** Total duration in milliseconds */
  totalDuration: number;
}
