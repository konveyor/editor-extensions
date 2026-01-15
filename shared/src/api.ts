/**
 * Konveyor Core Extension API
 * Types for inter-extension communication between core and language extensions
 */

/**
 * Initialization configuration for a provider instance
 */
// subset of https://github.com/konveyor/analyzer-lsp/blob/55a9f5fcb3bc0eb3429969c48db2d5b1524c8fdd/provider/provider.go#L123-L159
export interface ProviderInitConfig {
  /** Workspace location to analyze */
  location: string;

  /** Analysis mode (e.g., "source-only", "full-with-deps") */
  analysisMode: string;

  /** Provider-specific configuration */
  providerSpecificConfig?: Record<string, unknown>;

  /** Named pipe/socket path for LSP proxy communication (JSON-RPC) */
  pipeName?: string;
}

/**
 * Configuration for a language provider that will be passed to kai-analyzer-rpc
 */
export interface ProviderConfig {
  /** Provider name (e.g., "java", "python") */
  name: string;

  /** Address/path where kai-analyzer-rpc can connect to the provider (GRPC socket) */
  address: string;

  /** Whether to use sockets/named pipes for communication (true for UDS/Windows named pipes) */
  useSocket?: boolean;

  /** Initialization configuration for the provider */
  initConfig?: ProviderInitConfig[];

  /** Number of context lines to include around incidents */
  contextLines?: number;
}

/**
 * Registration information for a language provider extension
 */
export interface ProviderRegistration {
  /** Provider name (e.g., "java", "python") */
  name: string;

  /** Provider configuration for kai-analyzer-rpc */
  providerConfig: ProviderConfig;

  /** Paths to provider-specific rulesets */
  rulesetsPaths: string[];
}

/**
 * Analysis results provided to language extensions
 */
export interface AnalysisResults {
  /** Analysis completion status */
  success: boolean;

  /** Error message if analysis failed */
  error?: string;

  /** Number of incidents found */
  incidentCount?: number;
}

/**
 * Disposable resource that can be cleaned up
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Health check types
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

export interface HealthCheckContext {
  logger: any;
  state: any;
  vscode: any;
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
  /** Source extension name (e.g., "core", "java", "python") */
  extensionSource?: string;
  /** Function that performs the health check */
  check: (context: HealthCheckContext) => Promise<CheckResult>;
}

/**
 * Core extension API exported to language extensions
 */
export interface KonveyorCoreApi {
  /**
   * Get the version of the core extension
   * @returns The version of the core extension
   */
  readonly version: string;

  /**
   * Register a language provider with the core extension
   * @param config Provider registration configuration
   * @returns Disposable to unregister the provider
   */
  registerProvider(config: ProviderRegistration): Disposable;

  /**
   * Subscribe to analysis completion events
   * @param handler Callback invoked when analysis completes
   * @returns Disposable to unsubscribe
   */
  onAnalysisComplete(handler: (results: AnalysisResults) => void): Disposable;

  /**
   * Register a health check module
   * @param module Health check module to register
   * @returns Disposable to unregister the health check
   */
  registerHealthCheck(module: HealthCheckModule): Disposable;
}
