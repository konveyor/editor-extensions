import * as vscode from "vscode";
import { HubConfig } from "@editor-extensions/shared";

const HUB_CONFIG_SECRET_KEY = "konveyor.hub.config";

/**
 * Save hub configuration to VS Code Secret Storage
 */
export async function saveHubConfig(
  context: vscode.ExtensionContext,
  config: HubConfig,
): Promise<void> {
  await context.secrets.store(HUB_CONFIG_SECRET_KEY, JSON.stringify(config));
}

/**
 * Load hub configuration from VS Code Secret Storage
 */
export async function loadHubConfig(
  context: vscode.ExtensionContext,
): Promise<HubConfig | undefined> {
  const stored = await context.secrets.get(HUB_CONFIG_SECRET_KEY);
  if (!stored) {
    return undefined;
  }

  try {
    return JSON.parse(stored) as HubConfig;
  } catch (error) {
    console.error("Failed to parse hub config from secrets:", error);
    return undefined;
  }
}

/**
 * Delete hub configuration from VS Code Secret Storage
 */
export async function deleteHubConfig(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(HUB_CONFIG_SECRET_KEY);
}

/**
 * Get default hub configuration
 */
export function getDefaultHubConfig(): HubConfig {
  return {
    enabled: false,
    url: "http://localhost:8080",
    auth: {
      enabled: false,
      realm: "tackle",
      username: "admin",
      password: "",
      insecure: false,
    },
    features: {
      solutionServer: {
        enabled: true,
      },
      profileSync: {
        enabled: false,
      },
    },
  };
}

/**
 * Initialize hub config - loads from secrets or migrates from settings.json
 * This should be called once on extension activation
 */
export async function initializeHubConfig(context: vscode.ExtensionContext): Promise<HubConfig> {
  // Try to load from secret storage first
  const config = await loadHubConfig(context);

  if (config) {
    return config;
  }
  return getDefaultHubConfig();
}
