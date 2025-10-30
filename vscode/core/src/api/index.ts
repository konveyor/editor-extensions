import * as vscode from "vscode";
import { Logger } from "winston";
import { KonveyorCoreApi, ProviderRegistration, AnalysisResults } from "@editor-extensions/shared";

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
 * Create the Konveyor Core API instance
 */
export function createCoreApi(registry: ProviderRegistry): KonveyorCoreApi {
  return {
    registerProvider: (config: ProviderRegistration) => registry.registerProvider(config),
    onAnalysisComplete: (handler: (results: AnalysisResults) => void) =>
      registry.onAnalysisComplete(handler),
  };
}
