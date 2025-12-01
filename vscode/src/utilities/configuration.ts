import * as vscode from "vscode";
import * as pathlib from "path";
import { fileURLToPath } from "url";
import { EXTENSION_NAME } from "./constants";
import {
  AnalysisProfile,
  createConfigError,
  ExtensionData,
  SolutionServerConfig,
} from "@editor-extensions/shared";

function getConfigValue<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration(EXTENSION_NAME)?.get<T>(key);
}

async function updateConfigValue<T>(
  key: string,
  value: T | undefined,
  scope: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
): Promise<void> {
  try {
    await vscode.workspace.getConfiguration(EXTENSION_NAME).update(key, value, scope);
  } catch (error) {
    // Log the error for debugging
    console.error(`Failed to update configuration key "${key}":`, error);

    let errorMessage = `Failed to update setting "${key}": `;

    if (error instanceof Error) {
      if (error.message.includes("Unable to write")) {
        errorMessage += "Your settings.json may contain syntax errors.";
      } else {
        errorMessage += error.message;
      }
    } else {
      errorMessage += String(error);
    }

    // Show error notification with option to open settings
    vscode.window.showErrorMessage(errorMessage, "Open Settings").then(async (action) => {
      if (action === "Open Settings") {
        await vscode.commands.executeCommand("workbench.action.openWorkspaceSettingsFile");
        // Show helpful tip about fixing JSON errors
        vscode.window
          .showInformationMessage(
            'Tip: Use "Format Document" (Shift+Alt+F) to help identify JSON syntax errors.',
            "Format Now",
          )
          .then((formatAction) => {
            if (formatAction === "Format Now") {
              vscode.commands.executeCommand("editor.action.formatDocument");
            }
          });
      }
    });

    // Re-throw the error so callers can handle it if needed
    throw error;
  }
}

export const getConfigAnalyzerPath = (): string => getConfigValue<string>("analyzerPath") || "";

export const getConfigSolutionServer = (): SolutionServerConfig => {
  const config = getConfigValue<Partial<SolutionServerConfig>>("solutionServer") || {};
  return {
    enabled: config.enabled ?? false,
    url: config.url || "http://localhost:8000",
    auth: {
      enabled: config.auth?.enabled ?? false,
      realm: config.auth?.realm || "tackle",
      insecure: config.auth?.insecure ?? false,
    },
  };
};

// Legacy getters for backward compatibility - will be removed after refactoring
export const getConfigSolutionServerUrl = (): string => getConfigSolutionServer().url;
export const getConfigSolutionServerEnabled = (): boolean => getConfigSolutionServer().enabled;
export const getConfigSolutionServerAuth = (): boolean => getConfigSolutionServer().auth.enabled;
export const getConfigSolutionServerRealm = (): string => getConfigSolutionServer().auth.realm;
export const getConfigSolutionServerInsecure = (): boolean =>
  getConfigSolutionServer().auth.insecure;
export const getConfigLogLevel = (): string => getConfigValue<string>("logLevel") || "debug";
export const getConfigLabelSelector = (): string =>
  getConfigValue<string>("analysis.labelSelector") || "discovery";
export const getConfigAnalyzeOnSave = (): boolean => {
  const agentMode = getConfigAgentMode();
  const analyzeOnSave = getConfigValue<boolean>("analysis.analyzeOnSave") ?? true;

  // When agent mode is enabled, analyzeOnSave must be enabled
  if (agentMode && !analyzeOnSave) {
    console.warn(
      "Agent mode is enabled but analyzeOnSave is disabled. Forcing analyzeOnSave to true for agent mode compatibility.",
    );
    return true;
  }

  return analyzeOnSave;
};
export const getCacheDir = (workspaceRoot: string | undefined): string | undefined =>
  getWorkspaceRelativePath(getConfigValue<string>("genai.cacheDir"), workspaceRoot);
export const getTraceDir = (workspaceRoot: string | undefined): string | undefined =>
  getWorkspaceRelativePath(getConfigValue<string>("genai.traceDir"), workspaceRoot);
export const getTraceEnabled = (): boolean =>
  getConfigValue<boolean>("genai.traceEnabled") || false;
export const getConfigKaiDemoMode = (): boolean =>
  getConfigValue<boolean>("genai.demoMode") ?? false;
export const getConfigGenAIEnabled = (): boolean =>
  getConfigValue<boolean>("genai.enabled") ?? true;
export const getConfigAgentMode = (): boolean =>
  getConfigValue<boolean>("genai.agentMode") ?? false;
export const getConfigAutoAcceptOnSave = (): boolean =>
  getConfigValue<boolean>("diff.autoAcceptOnSave") ?? false;
export const getExcludedDiagnosticSources = (): string[] =>
  getConfigValue<string[]>("genai.excludedDiagnosticSources") ?? [];

/**
 * Get all configuration values for keys defined in the package.json file. Used in debugging.
 * @returns A record of all configuration values.
 */
export function getAllConfigurationValues(): Record<string, any> {
  const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
  const result: Record<string, any> = {};
  for (const key of Object.keys(config)) {
    if (!key.startsWith("inspect") && !key.startsWith("update")) {
      result[key] = config.get(key);
    }
  }
  return result;
}

export const updateSolutionServerConfig = async (
  config: Partial<SolutionServerConfig>,
): Promise<void> => {
  const currentConfig = getConfigSolutionServer();
  const newConfig = {
    ...currentConfig,
    ...config,
    auth: {
      ...currentConfig.auth,
      ...config.auth,
    },
  };
  await updateConfigValue("solutionServer", newConfig, vscode.ConfigurationTarget.Workspace);
};

// Legacy setters for backward compatibility - will be removed after refactoring
export const updateSolutionServerUrl = async (value: string | undefined): Promise<void> => {
  await updateSolutionServerConfig({ url: value || "http://localhost:8000" });
};
export const updateSolutionServerEnabled = async (value: boolean): Promise<void> => {
  await updateSolutionServerConfig({ enabled: value });
};
export const updateAnalyzerPath = async (value: string | undefined): Promise<void> => {
  await updateConfigValue("analyzerPath", value, vscode.ConfigurationTarget.Workspace);
};
export const toggleAgentMode = async (): Promise<void> => {
  const currentValue = getConfigAgentMode();
  await updateConfigValue("genai.agentMode", !currentValue, vscode.ConfigurationTarget.Workspace);
};

export const enableGenAI = async (): Promise<void> => {
  await updateConfigValue("genai.enabled", true, vscode.ConfigurationTarget.Workspace);
};

export const updateUseDefaultRuleSets = async (value: boolean): Promise<void> => {
  await updateConfigValue(
    "analysis.useDefaultRulesets",
    value,
    vscode.ConfigurationTarget.Workspace,
  );
};
export const updateLabelSelector = async (value: string): Promise<void> => {
  await updateConfigValue("analysis.labelSelector", value, vscode.ConfigurationTarget.Workspace);
};

export function updateConfigErrors(draft: ExtensionData, _settingsPath: string): void {
  const { activeProfileId, profiles } = draft;
  const profile = profiles.find((p) => p.id === activeProfileId);

  // Check for no active profile
  if (!profile) {
    draft.configErrors.push(createConfigError.noActiveProfile());
    return;
  }

  // Check label selector
  if (!profile.labelSelector?.trim()) {
    draft.configErrors.push(createConfigError.invalidLabelSelector());
  }

  // Check custom rules when default rules are disabled
  if (!profile.useDefaultRules && (!profile.customRules || profile.customRules.length === 0)) {
    draft.configErrors.push(createConfigError.noCustomRules());
  }
}

export const getConfigProfiles = (): AnalysisProfile[] =>
  getConfigValue<unknown[]>("profiles")?.map((p: any) => ({
    id: p.id ?? crypto.randomUUID(),
    name: p.name ?? "",
    mode: p.mode ?? "source-only",
    customRules: Array.isArray(p.customRules) ? [...p.customRules] : [],
    useDefaultRules: !!p.useDefaultRules,
    labelSelector: p.labelSelector ?? "",
  })) || [];

export const getConfigActiveProfileId = (): string | undefined => {
  const id = getConfigValue<string>("activeProfileId");
  const profiles = getConfigProfiles();
  return profiles.find((p) => p.id === id)?.id ?? profiles[0]?.id;
};

export const updateConfigActiveProfileIdfileId = async (id: string) => {
  return updateConfigValue("activeProfileId", id, vscode.ConfigurationTarget.Workspace);
};

export const updateConfigProfiles = async (profiles: AnalysisProfile[]): Promise<void> => {
  const safeProfiles = profiles.map((p) => {
    const { id, name, customRules, useDefaultRules, labelSelector } = p;
    return {
      id,
      name,
      customRules: Array.isArray(customRules) ? [...customRules] : [],
      useDefaultRules: !!useDefaultRules,
      labelSelector: labelSelector ?? "",
    };
  });
  await updateConfigValue("profiles", safeProfiles, vscode.ConfigurationTarget.Workspace);
};

export const updateConfigActiveProfileId = async (profileId: string): Promise<void> => {
  await updateConfigValue("activeProfileId", profileId, vscode.ConfigurationTarget.Workspace);
};

export function updateActiveProfileValidity(draft: ExtensionData, assetRulesetPath: string): void {
  const active = draft.profiles.find((p) => p.id === draft.activeProfileId);
  if (!active) {
    return;
  }

  const rulesets = [
    active.useDefaultRules ? assetRulesetPath : null,
    ...(active.customRules ?? []),
  ].filter(Boolean);

  // Remove existing profile-related errors
  draft.configErrors = draft.configErrors.filter(
    (error) => error.type !== "invalid-label-selector" && error.type !== "no-custom-rules",
  );

  // Add errors if needed
  if (!active.labelSelector?.trim()) {
    draft.configErrors.push(createConfigError.invalidLabelSelector());
  }

  if (rulesets.length === 0) {
    draft.configErrors.push(createConfigError.noCustomRules());
  }
}

export function getWorkspaceRelativePath(
  path: string | undefined,
  workspaceRoot: string | undefined,
): string | undefined {
  if (!path) {
    return undefined;
  }
  if (!workspaceRoot || pathlib.isAbsolute(path)) {
    return path;
  }
  return pathlib.join(fileUriToPath(workspaceRoot), path);
}

export function fileUriToPath(path: string): string {
  const cleanPath = path.startsWith("file://") ? fileURLToPath(path) : path;
  return process.platform === "win32" && cleanPath.match(/^\/[A-Za-z]:\//)
    ? cleanPath.substring(1)
    : cleanPath;
}
