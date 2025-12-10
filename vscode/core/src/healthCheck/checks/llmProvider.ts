/**
 * Health check for LLM provider connectivity and configuration
 */

import { HealthCheckModule, CheckResult, HealthCheckContext } from "../types";
import { parseModelConfig } from "../../modelProvider/config";
import { paths } from "../../paths";

export const llmProviderCheck: HealthCheckModule = {
  id: "llm-provider",
  name: "LLM Provider Connectivity",
  description: "Checks if the LLM provider is configured and can communicate",
  platforms: ["all"],
  enabled: true,
  extensionSource: "core",
  check: async (context: HealthCheckContext): Promise<CheckResult> => {
    const { logger, state } = context;

    try {
      // Check if model provider is configured
      if (!state.modelProvider) {
        // Try to parse config to see if it's a configuration issue
        try {
          const settingsPath = paths().settingsYaml;
          await parseModelConfig(settingsPath);

          return {
            name: "LLM Provider Connectivity",
            status: "warning",
            message: "LLM provider configuration found but not initialized",
            details:
              "Provider settings exist but the provider has not been initialized. " +
              "This may occur if GenAI features are not enabled or if there was an initialization error.",
            suggestion:
              "Check the Output panel for initialization errors, or enable GenAI features using the 'Enable GenAI' command.",
          };
        } catch (configError) {
          return {
            name: "LLM Provider Connectivity",
            status: "fail",
            message: "LLM provider not configured",
            details: `Configuration error: ${configError instanceof Error ? configError.message : String(configError)}`,
            suggestion:
              "Configure your LLM provider settings using 'Konveyor: Open Model Provider Settings' command.",
          };
        }
      }

      // Model provider exists, now test connectivity
      logger.info("Testing LLM provider connectivity with simple message...");

      try {
        // Use a simple test message to check connectivity
        const testResponse = await state.modelProvider.invoke("Hello", {
          timeout: 10000, // 10 second timeout
        });

        if (!testResponse || !testResponse.content) {
          return {
            name: "LLM Provider Connectivity",
            status: "warning",
            message: "LLM provider responded but with unexpected format",
            details: `Response received but content was empty or invalid. Response: ${JSON.stringify(testResponse)}`,
            suggestion: "Check your model provider configuration and API settings.",
          };
        }

        // Success!
        const responsePreview =
          typeof testResponse.content === "string"
            ? testResponse.content.substring(0, 100)
            : JSON.stringify(testResponse.content).substring(0, 100);

        return {
          name: "LLM Provider Connectivity",
          status: "pass",
          message: "LLM provider is responding correctly",
          details: `Successfully communicated with the LLM provider.\nTest response preview: ${responsePreview}${responsePreview.length >= 100 ? "..." : ""}`,
        };
      } catch (providerError) {
        // Connectivity/API error
        const errorMessage =
          providerError instanceof Error ? providerError.message : String(providerError);
        const errorStack = providerError instanceof Error ? providerError.stack : undefined;

        // Try to provide helpful suggestions based on common errors
        let suggestion = "Check your API credentials, network connection, and provider settings.";

        if (errorMessage.includes("timeout") || errorMessage.includes("ETIMEDOUT")) {
          suggestion =
            "Request timed out. Check your network connection and provider endpoint URL.";
        } else if (errorMessage.includes("401") || errorMessage.includes("unauthorized")) {
          suggestion =
            "Authentication failed. Check your API key or credentials in the provider settings.";
        } else if (errorMessage.includes("403") || errorMessage.includes("forbidden")) {
          suggestion = "Access forbidden. Verify your API key has the necessary permissions.";
        } else if (errorMessage.includes("404")) {
          suggestion = "Endpoint not found. Check your model name and provider endpoint URL.";
        } else if (errorMessage.includes("429") || errorMessage.includes("rate limit")) {
          suggestion = "Rate limit exceeded. Wait a moment and try again, or check your API quota.";
        } else if (errorMessage.includes("ENOTFOUND") || errorMessage.includes("ECONNREFUSED")) {
          suggestion =
            "Cannot reach the provider endpoint. Check your network connection and proxy settings.";
        } else if (errorMessage.includes("certificate") || errorMessage.includes("SSL")) {
          suggestion =
            "SSL/TLS certificate error. Check your network security settings or CA bundle configuration.";
        }

        return {
          name: "LLM Provider Connectivity",
          status: "fail",
          message: "Failed to communicate with LLM provider",
          details: `Error: ${errorMessage}${errorStack ? `\n\nStack trace:\n${errorStack}` : ""}`,
          suggestion,
        };
      }
    } catch (err) {
      logger.error("Error during LLM provider health check", err);
      return {
        name: "LLM Provider Connectivity",
        status: "fail",
        message: "Health check encountered an unexpected error",
        details: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
