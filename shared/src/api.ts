/**
 * Konveyor Core Extension API
 * Types for inter-extension communication between core and language extensions
 */

/**
 * Initialization configuration for a provider instance
 */
export interface ProviderInitConfig {
  /** Workspace location to analyze */
  location: string;

  /** Analysis mode (e.g., "source-only", "full-with-deps") */
  analysisMode: string;

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
  useSockets?: boolean;

  /** Initialization configuration for the provider */
  initConfig?: ProviderInitConfig[];

  /** Number of context lines to include around incidents */
  contextLines?: number;
}

/**
 * Metadata about a provider's supported migration bundles
 */
export interface BundleMetadata {
  /** Supported source technologies (e.g., ["eap6", "eap7", "jakarta-ee"]) */
  sources: string[];

  /** Supported target technologies (e.g., ["eap8", "quarkus", "springboot"]) */
  targets: string[];
}

/**
 * Registration information for a language provider extension
 */
export interface ProviderRegistration {
  /** Provider name (e.g., "java", "python") */
  name: string;

  /** Provider configuration for kai-analyzer-rpc */
  providerConfig: ProviderConfig;

  /** Function to retrieve bundle metadata (sources and targets) */
  getBundleMetadata: () => BundleMetadata;

  /** File extensions this provider supports (e.g., [".java", ".jar", ".war"]) */
  supportsFileExtensions: string[];

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
