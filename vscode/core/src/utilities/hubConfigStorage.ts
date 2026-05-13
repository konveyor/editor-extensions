import * as vscode from "vscode";
import { HubConfig } from "@editor-extensions/shared";
import { EXTENSION_NAME } from "./constants";

const HUB_CONFIG_SECRET_KEY = `${EXTENSION_NAME}.hub.config`;

interface HubEnvVars {
  url?: string;
  username?: string;
  password?: string;
  forceEnabled: boolean;
  insecure: boolean;
  solutionServerEnabled: boolean;
  profileSyncEnabled: boolean;
}

function getHubEnvVars(): HubEnvVars {
  return {
    url: process.env.HUB_URL,
    username: process.env.HUB_USERNAME,
    password: process.env.HUB_PASSWORD,
    forceEnabled: process.env.FORCE_HUB_ENABLED === "true",
    insecure: process.env.HUB_INSECURE === "true",
    solutionServerEnabled: process.env.HUB_SOLUTION_SERVER_ENABLED !== "false", // defaults to true
    profileSyncEnabled: process.env.HUB_PROFILE_SYNC_ENABLED !== "false", // defaults to true
  };
}

export function isHubForced(): boolean {
  return process.env.FORCE_HUB_ENABLED === "true";
}

/**
 * Save hub configuration to VS Code Secret Storage
 */
export async function saveHubConfig(
  context: vscode.ExtensionContext,
  config: HubConfig,
): Promise<void> {
  try {
    const configString = JSON.stringify(config);

    // Add a timeout to prevent hanging indefinitely if the system's keyring can't be reached
    const storePromise = context.secrets.store(HUB_CONFIG_SECRET_KEY, configString);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Secret storage timeout after 5s")), 5000),
    );

    await Promise.race([storePromise, timeoutPromise]);
  } catch (error) {
    console.error("[saveHubConfig] Error saving hub config:", error);
    console.warn("[saveHubConfig] Continuing despite secret storage failure");
  }
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
 * Get default hub configuration with environment variable overrides
 */
export function getDefaultHubConfig(): HubConfig {
  const env = getHubEnvVars();
  const authEnabled = !!(env.username || env.password);
  const hubEnabled = env.forceEnabled || !!(env.url || authEnabled);

  return {
    enabled: hubEnabled,
    url: env.url || "http://localhost:8080",
    auth: {
      enabled: authEnabled,
      username: env.username || "admin",
      password: env.password || "",
      insecure: env.insecure,
    },
    features: {
      solutionServer: {
        enabled:
          process.env.HUB_SOLUTION_SERVER_ENABLED !== undefined ? env.solutionServerEnabled : true, // Default to true for new configs
      },
      profileSync: {
        enabled:
          process.env.HUB_PROFILE_SYNC_ENABLED !== undefined ? env.profileSyncEnabled : hubEnabled, // Default to enabled when hub is enabled
      },
    },
  };
}

/**
 * Initialize hub config - loads from secrets or migrates from settings.json
 * This should be called once on extension activation
 */
export async function initializeHubConfig(context: vscode.ExtensionContext): Promise<HubConfig> {
  const savedConfig = await loadHubConfig(context);
  const env = getHubEnvVars();

  if (!savedConfig) {
    return getDefaultHubConfig();
  }

  const hubEnabled = env.forceEnabled || !!env.url || savedConfig.enabled;
  const authEnabled = env.username || env.password ? true : savedConfig.auth.enabled;

  return {
    enabled: hubEnabled,
    url: env.url || savedConfig.url,
    auth: {
      enabled: authEnabled,
      username: env.username || savedConfig.auth.username,
      password: env.password || savedConfig.auth.password,
      insecure: process.env.HUB_INSECURE !== undefined ? env.insecure : savedConfig.auth.insecure,
    },
    features: {
      solutionServer: {
        enabled:
          process.env.HUB_SOLUTION_SERVER_ENABLED !== undefined
            ? env.solutionServerEnabled
            : savedConfig.features.solutionServer.enabled,
      },
      profileSync: {
        enabled:
          process.env.HUB_PROFILE_SYNC_ENABLED !== undefined
            ? env.profileSyncEnabled
            : savedConfig.features.profileSync.enabled,
      },
    },
  };
}
