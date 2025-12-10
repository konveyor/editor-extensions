/**
 * Health check for registered language providers
 */

import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";

export const languageProvidersCheck: HealthCheckModule = {
  id: "language-providers",
  name: "Language Providers",
  description: "Checks if language providers are registered with the analyzer",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { state, logger } = context;

    try {
      const analyzerClient = state.analyzerClient;
      if (!analyzerClient) {
        return {
          name: "Language Providers",
          status: "fail",
          message: "Analyzer client not initialized",
        };
      }

      const providers = analyzerClient.getRegisteredProviders();

      if (providers.length === 0) {
        return {
          name: "Language Providers",
          status: "warning",
          message: "No language providers are registered",
          details:
            "Language providers (e.g., Konveyor Java, Konveyor Go) may still be loading. Analysis cannot run until at least one provider is registered.",
          suggestion:
            "Wait for language extensions to finish loading. Check that language-specific extensions are installed.",
        };
      }

      let details = `Registered Providers: ${providers.length}\n\n`;
      for (const provider of providers) {
        details += `Provider: ${provider.name}\n`;
        if (provider.providerConfig) {
          details += `  Config: ${JSON.stringify(provider.providerConfig, null, 2).replace(/\n/g, "\n  ")}\n`;
        }
        details += "\n";
      }

      return {
        name: "Language Providers",
        status: "pass",
        message: `${providers.length} language provider(s) registered`,
        details: details.trim(),
      };
    } catch (err) {
      logger.error("Error checking language providers", err);
      return {
        name: "Language Providers",
        status: "fail",
        message: "Failed to check language providers",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
