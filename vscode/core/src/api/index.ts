import * as vscode from "vscode";
import { Logger } from "winston";
import {
  KonveyorCoreApi,
  ProviderRegistration,
  AnalysisResults,
  HealthCheckModule,
} from "@editor-extensions/shared";

/**
 * Provider registry that manages registered language providers
 */
export class ProviderRegistry {
  private providers: Map<string, ProviderRegistration> = new Map();
  private analysisCompleteEmitter = new vscode.EventEmitter<AnalysisResults>();

  constructor(private logger: Logger) {}

  /**
   * Register a language provider
   */
  registerProvider(config: ProviderRegistration): vscode.Disposable {
    this.logger.info(`Registering provider: ${config.name}`, {
      rulesetsPaths: config.rulesetsPaths,
    });

    if (this.providers.has(config.name)) {
      this.logger.warn(`Provider ${config.name} is already registered, overwriting`);
    }

    this.providers.set(config.name, config);

    return new vscode.Disposable(() => {
      this.logger.info(`Unregistering provider: ${config.name}`);
      this.providers.delete(config.name);
    });
  }

  /**
   * Get all registered providers
   */
  getProviders(): ProviderRegistration[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name: string): ProviderRegistration | undefined {
    return this.providers.get(name);
  }

  /**
   * Emit analysis complete event
   */
  emitAnalysisComplete(results: AnalysisResults): void {
    this.logger.debug("Emitting analysis complete event", results);
    this.analysisCompleteEmitter.fire(results);
  }

  /**
   * Subscribe to analysis complete events
   */
  onAnalysisComplete(handler: (results: AnalysisResults) => void): vscode.Disposable {
    return this.analysisCompleteEmitter.event(handler);
  }

  /**
   * Dispose the registry
   */
  dispose(): void {
    this.analysisCompleteEmitter.dispose();
    this.providers.clear();
  }
}

/**
 * Health check registry that manages registered health check modules
 */
export class HealthCheckRegistry {
  private healthChecks: Map<string, HealthCheckModule> = new Map();

  constructor(private logger: Logger) {}

  /**
   * Register a health check module
   */
  registerHealthCheck(module: HealthCheckModule): vscode.Disposable {
    this.logger.info(`Registering health check: ${module.id} (${module.name})`);

    if (this.healthChecks.has(module.id)) {
      this.logger.warn(`Health check ${module.id} is already registered, overwriting`);
    }

    this.healthChecks.set(module.id, module);

    return new vscode.Disposable(() => {
      this.logger.info(`Unregistering health check: ${module.id}`);
      this.healthChecks.delete(module.id);
    });
  }

  /**
   * Get all registered health check modules
   */
  getHealthChecks(): HealthCheckModule[] {
    return Array.from(this.healthChecks.values());
  }

  /**
   * Get a specific health check by ID
   */
  getHealthCheck(id: string): HealthCheckModule | undefined {
    return this.healthChecks.get(id);
  }

  /**
   * Dispose the registry
   */
  dispose(): void {
    this.healthChecks.clear();
  }
}

/**
 * Create the Konveyor Core API instance
 */
export function createCoreApi(
  providerRegistry: ProviderRegistry,
  healthCheckRegistry: HealthCheckRegistry,
  version: string,
): KonveyorCoreApi {
  return {
    version,
    registerProvider: (config: ProviderRegistration) => providerRegistry.registerProvider(config),
    onAnalysisComplete: (handler: (results: AnalysisResults) => void) =>
      providerRegistry.onAnalysisComplete(handler),
    registerHealthCheck: (module: HealthCheckModule) =>
      healthCheckRegistry.registerHealthCheck(module),
  };
}
