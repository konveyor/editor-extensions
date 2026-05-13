/**
 * Types for the Health Check system
 * Re-export from shared package for backward compatibility
 */

import type { CheckStatus, CheckResult } from "@editor-extensions/shared";

export type {
  CheckStatus,
  Platform,
  CheckResult,
  HealthCheckModule,
  HealthCheckContext,
} from "@editor-extensions/shared";

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
