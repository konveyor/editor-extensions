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
  pipeName: string;
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
 * Core extension API exported to language extensions
 */
export interface KonveyorCoreApi {
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
}
