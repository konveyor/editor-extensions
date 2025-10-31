/**
 * Go language provider configuration for Konveyor
 */

import {
  ProviderConfig,
  ProviderRegistration,
  ProviderInitConfig,
} from "@editor-extensions/shared";

/**
 * Go provider configuration
 */
export class GoProviderConfig {
  public readonly name = "go";

  // File extensions this provider supports
  public readonly supportedExtensions = [".go", ".mod", ".sum"];

  // Paths to Go-specific rulesets
  public readonly rulesetPaths = ["../../downloaded_assets/rulesets/go"];

  /**
   * Get provider configuration for kai-analyzer-rpc
   */
  public getProviderConfig(
    providerAddress: string,
    initConfig?: ProviderInitConfig,
  ): ProviderConfig {
    const config: ProviderConfig = {
      name: this.name,
      address: providerAddress, // GRPC socket address (formatted as unix:path)
      useSockets: true, // Use named pipes/sockets for communication
      contextLines: 10,
    };

    // If init config is provided, include it
    if (initConfig) {
      config.initConfig = [initConfig];
    }

    return config;
  }

  /**
   * Create the complete provider registration
   */
  public createProviderRegistrationWithAddress(
    providerAddress: string,
    initConfig?: ProviderInitConfig,
  ): ProviderRegistration {
    return {
      name: this.name,
      providerConfig: this.getProviderConfig(providerAddress, initConfig),
      rulesetsPaths: this.rulesetPaths,
    };
  }

  /**
   * Create the complete provider registration (backwards compatibility)
   */
  public createProviderRegistration(initConfig?: ProviderInitConfig): ProviderRegistration {
    // Default address if none provided
    const defaultAddress = "localhost:8080";
    return this.createProviderRegistrationWithAddress(defaultAddress, initConfig);
  }

  /**
   * Check if a file is supported by this provider
   */
  public isFileSupported(filename: string): boolean {
    const lowercaseName = filename.toLowerCase();
    return this.supportedExtensions.some((ext) => lowercaseName.endsWith(ext));
  }
}

// Export singleton instance
export const goProviderConfig = new GoProviderConfig();
