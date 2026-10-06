/**
 * Health check for LLM provider connectivity and configuration
 */

import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import { parseModelConfig, getModelProviderFromConfig } from "../../modelProvider/config";
import { paths } from "../../paths";
import { CheckResultBuilder, withErrorHandling, formatError } from "../helpers";
import { EXTENSION_SHORT_NAME } from "../../utilities/constants";
import {
  classifyNetworkError,
  describeErrorChain,
  NetworkErrorCategory,
} from "../../utilities/networkDiagnostics";

const HTTP_STATUS_SUGGESTIONS: Array<[RegExp, string]> = [
  [
    /\b401\b|unauthorized/i,
    "Authentication failed. Check your API key or credentials in the provider settings.",
  ],
  [/\b403\b|forbidden/i, "Access forbidden. Verify your API key has the necessary permissions."],
  [/\b404\b/, "Endpoint not found. Check your model name and provider endpoint URL."],
  [
    /\b429\b|rate limit/i,
    "Rate limit exceeded. Wait a moment and try again, or check your API quota.",
  ],
];

/**
 * Suggest a remedy for a provider error.
 *
 * Transport failures are classified from the `cause` chain rather than the
 * top-level message - SDKs collapse every network failure into an opaque
 * string ("Connection error.") that matches no keyword. HTTP-level failures
 * do carry a status in the message, so those are matched textually.
 */
function getSuggestionForError(error: unknown, errorMessage: string): string {
  for (const [pattern, suggestion] of HTTP_STATUS_SUGGESTIONS) {
    if (pattern.test(errorMessage)) {
      return suggestion;
    }
  }

  const classified = classifyNetworkError(error);
  if (classified.category !== NetworkErrorCategory.UNKNOWN) {
    return classified.suggestion;
  }

  return "Check your API credentials, network connection, and provider settings.";
}

export const llmProviderCheck: HealthCheckModule = {
  id: "llm-provider",
  name: "LLM Provider Connectivity",
  description: "Checks if the LLM provider is configured and can communicate",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { logger, state } = context;
    const builder = new CheckResultBuilder("LLM Provider Connectivity");

    return withErrorHandling("LLM Provider Connectivity", logger, async () => {
      if (!state.modelProvider) {
        let parsedConfig;
        try {
          parsedConfig = await parseModelConfig(paths().settingsYaml);
        } catch (configError) {
          return builder.fail(
            "LLM provider not configured",
            `Configuration error: ${formatError(configError)}`,
            `Configure your LLM provider settings using '${EXTENSION_SHORT_NAME}: Open Model Provider Settings' command.`,
          );
        }

        // `modelProvider` is cleared whenever the startup health check fails, so
        // bailing out here would skip the connectivity test in exactly the case
        // the user ran this check to diagnose. Build a provider from the config
        // and let it surface the real initialization error instead.
        try {
          await getModelProviderFromConfig(parsedConfig, logger);
          return builder.warning(
            "LLM provider initialized on retry but is not active in this session",
            "The provider could not be initialized at startup but connected successfully just now. " +
              "This usually means a transient network failure, or that settings changed after startup.",
            "Reload the window to pick up the working provider.",
          );
        } catch (initError) {
          const errorMessage = formatError(initError);
          return builder.fail(
            "LLM provider configured but failed to initialize",
            `Error: ${errorMessage}\n\nCause chain:\n${describeErrorChain(initError)}`,
            getSuggestionForError(initError, errorMessage),
          );
        }
      }

      const hubProxy = state.hubConnectionManager?.getLLMProxyConfig?.();
      logger.info("LLM provider health check context", {
        modelProviderSource: state.modelProviderSource ?? "unknown",
        hubProxyAvailable: hubProxy?.available ?? false,
        hubProxyEndpoint: hubProxy?.endpoint,
        hasBearerToken: !!state.hubConnectionManager?.getBearerToken?.(),
      });

      logger.info("Testing LLM provider connectivity with simple message...");

      try {
        const testResponse = await state.modelProvider.invoke("Hello", {
          timeout: 10000,
        });

        if (!testResponse || !testResponse.content) {
          return builder.warning(
            "LLM provider responded but with unexpected format",
            `Response received but content was empty or invalid. Response: ${JSON.stringify(testResponse)}`,
            "Check your model provider configuration and API settings.",
          );
        }

        const responsePreview =
          typeof testResponse.content === "string"
            ? testResponse.content.substring(0, 100)
            : JSON.stringify(testResponse.content).substring(0, 100);

        return builder.pass(
          "LLM provider is responding correctly",
          `Successfully communicated with the LLM provider.\nTest response preview: ${responsePreview}${responsePreview.length >= 100 ? "..." : ""}`,
        );
      } catch (providerError) {
        const errorMessage = formatError(providerError);
        const errorStack = providerError instanceof Error ? providerError.stack : undefined;
        const suggestion = getSuggestionForError(providerError, errorMessage);

        return builder.fail(
          "Failed to communicate with LLM provider",
          `Error: ${errorMessage}\n\nCause chain:\n${describeErrorChain(providerError)}` +
            `${errorStack ? `\n\nStack trace:\n${errorStack}` : ""}`,
          suggestion,
        );
      }
    });
  },
};
