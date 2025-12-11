/**
 * Health check for LLM provider connectivity and configuration
 */

import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import { parseModelConfig } from "../../modelProvider/config";
import { paths } from "../../paths";
import { CheckResultBuilder, withErrorHandling, formatError } from "../helpers";

const ERROR_SUGGESTIONS: Record<string, string> = {
  timeout: "Request timed out. Check your network connection and provider endpoint URL.",
  ETIMEDOUT: "Request timed out. Check your network connection and provider endpoint URL.",
  "401": "Authentication failed. Check your API key or credentials in the provider settings.",
  unauthorized:
    "Authentication failed. Check your API key or credentials in the provider settings.",
  "403": "Access forbidden. Verify your API key has the necessary permissions.",
  forbidden: "Access forbidden. Verify your API key has the necessary permissions.",
  "404": "Endpoint not found. Check your model name and provider endpoint URL.",
  "429": "Rate limit exceeded. Wait a moment and try again, or check your API quota.",
  "rate limit": "Rate limit exceeded. Wait a moment and try again, or check your API quota.",
  ENOTFOUND:
    "Cannot reach the provider endpoint. Check your network connection and proxy settings.",
  ECONNREFUSED:
    "Cannot reach the provider endpoint. Check your network connection and proxy settings.",
  certificate:
    "SSL/TLS certificate error. Check your network security settings or CA bundle configuration.",
  SSL: "SSL/TLS certificate error. Check your network security settings or CA bundle configuration.",
};

function getSuggestionForError(errorMessage: string): string {
  for (const [key, suggestion] of Object.entries(ERROR_SUGGESTIONS)) {
    if (errorMessage.includes(key)) {
      return suggestion;
    }
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
        try {
          const settingsPath = paths().settingsYaml;
          await parseModelConfig(settingsPath);

          return builder.warning(
            "LLM provider configuration found but not initialized",
            "Provider settings exist but the provider has not been initialized. " +
              "This may occur if GenAI features are not enabled or if there was an initialization error.",
            "Check the Output panel for initialization errors, or enable GenAI features using the 'Enable GenAI' command.",
          );
        } catch (configError) {
          return builder.fail(
            "LLM provider not configured",
            `Configuration error: ${formatError(configError)}`,
            "Configure your LLM provider settings using 'Konveyor: Open Model Provider Settings' command.",
          );
        }
      }

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
        const suggestion = getSuggestionForError(errorMessage);

        return builder.fail(
          "Failed to communicate with LLM provider",
          `Error: ${errorMessage}${errorStack ? `\n\nStack trace:\n${errorStack}` : ""}`,
          suggestion,
        );
      }
    });
  },
};
