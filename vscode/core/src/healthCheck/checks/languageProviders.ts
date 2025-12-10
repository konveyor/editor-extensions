/**
 * Health check for registered language providers
 */

import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import { CheckResultBuilder, withErrorHandling } from "../helpers";

export const languageProvidersCheck: HealthCheckModule = {
  id: "language-providers",
  name: "Language Providers",
  description: "Checks if language providers are registered with the analyzer",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { state, logger } = context;
    const builder = new CheckResultBuilder("Language Providers");

    return withErrorHandling("Language Providers", logger, async () => {
      if (!state.analyzerClient) {
        return builder.fail("Analyzer client not initialized");
      }

      const providers = state.analyzerClient.getRegisteredProviders();

      if (providers.length === 0) {
        return builder.warning(
          "No language providers are registered",
          "Language providers (e.g., Konveyor Java, Konveyor Go) may still be loading. Analysis cannot run until at least one provider is registered.",
          "Wait for language extensions to finish loading. Check that language-specific extensions are installed.",
        );
      }

      const providerDetails = providers.map((provider: any) => {
        const config = provider.providerConfig
          ? `\n  Config: ${JSON.stringify(provider.providerConfig, null, 2).replace(/\n/g, "\n  ")}`
          : "";
        return `Provider: ${provider.name}${config}`;
      });

      const details = `Registered Providers: ${providers.length}\n\n${providerDetails.join("\n\n")}`;

      return builder.pass(`${providers.length} language provider(s) registered`, details);
    });
  },
};
