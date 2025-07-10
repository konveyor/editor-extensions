import * as vscode from "vscode";
import * as yaml from "js-yaml";
import * as fs from "fs";
import deepEqual from "fast-deep-equal";
import { ServerLogLevels } from "../client/types";
import { KONVEYOR_CONFIG_KEY } from "./constants";
import { ExtensionState } from "../extensionState";
import {
  AnalysisProfile,
  createConfigError,
  ExtensionData,
  ProviderConfigFile,
  ProviderConfigStatus,
  effortLevels,
  getEffortValue,
  SolutionEffortLevel,
} from "@editor-extensions/shared";

function getConfigValue<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration(KONVEYOR_CONFIG_KEY)?.get<T>(key);
}

async function updateConfigValue<T>(
  key: string,
  value: T | undefined,
  scope: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
): Promise<void> {
  await vscode.workspace.getConfiguration(KONVEYOR_CONFIG_KEY).update(key, value, scope);
}

export const getConfigAnalyzerPath = (): string => getConfigValue<string>("analyzerPath") || "";
export const getConfigKaiRpcServerPath = (): string =>
  getConfigValue<string>("kaiRpcServerPath") || "";
export const getConfigSolutionServerUrl = (): string =>
  getConfigValue<string>("solutionServer.url") || "http://localhost:8000";
export const getConfigSolutionServerEnabled = (): boolean =>
  getConfigValue<boolean>("solutionServer.enabled") ?? false;
export const getConfigLogLevel = (): ServerLogLevels =>
  getConfigValue<ServerLogLevels>("logLevel") || "DEBUG";
export const getConfigLoggingTraceMessageConnection = (): boolean =>
  getConfigValue<boolean>("logging.traceMessageConnection") ?? false;
export const getConfigIncidentLimit = (): number =>
  getConfigValue<number>("analysis.incidentLimit") || 10000;
export const getConfigContextLines = (): number =>
  getConfigValue<number>("analysis.contextLines") || 10;

export const getConfigCodeSnipLimit = (): number =>
  getConfigValue<number>("analysis.codeSnipLimit") || 10;

export const getConfigLabelSelector = (): string =>
  getConfigValue<string>("analysis.labelSelector") || "discovery";
export const getConfigAnalyzeKnownLibraries = (): boolean =>
  getConfigValue<boolean>("analysis.analyzeKnownLibraries") ?? false;
export const getConfigAnalyzeDependencies = (): boolean =>
  getConfigValue<boolean>("analysis.analyzeDependencies") ?? true;
export const getConfigAnalyzeOnSave = (): boolean =>
  getConfigValue<boolean>("analysis.analyzeOnSave") ?? true;
export const getConfigDiffEditorType = (): string =>
  getConfigValue<"diff" | "merge">("diffEditorType") || "diff";
export const getCacheDir = (): string | undefined => getConfigValue<string>("kai.cacheDir");
export const getTraceEnabled = (): boolean => getConfigValue<boolean>("kai.traceEnabled") || false;
export const getConfigKaiDemoMode = (): boolean => getConfigValue<boolean>("kai.demoMode") ?? false;

export const getConfigSolutionMaxPriority = (): number | undefined =>
  getConfigValue<number | null>("kai.getSolutionMaxPriority") ?? undefined;
export const getConfigSolutionMaxEffortLevel = (): SolutionEffortLevel =>
  getConfigValue<string>("kai.getSolutionMaxEffort") as SolutionEffortLevel;
export const getConfigSolutionMaxEffortValue = (): number | undefined => {
  const level = getConfigValue<string>("kai.getSolutionMaxEffort");
  return level && level in effortLevels ? getEffortValue(level as SolutionEffortLevel) : 0;
};
export const getConfigMaxLLMQueries = (): number | undefined =>
  getConfigValue<number | null>("kai.getSolutionMaxLLMQueries") ?? undefined;
export const getConfigAgentMode = (): boolean => getConfigValue<boolean>("kai.agentMode") ?? false;
export const getConfigSuperAgentMode = (): boolean =>
  getConfigValue<boolean>("kai.superAgentMode") ?? false;
export const getExcludedDiagnosticSources = (): string[] =>
  getConfigValue<string[]>("kai.excludedDiagnosticSources") ?? [];

export const getProviderConfigStatus = (filepath: string): ProviderConfigStatus => {
  try {
    const fileContents = fs.readFileSync(filepath, "utf8");
    const config = yaml.load(fileContents) as ProviderConfigFile;
    const models = config?.models ?? {};
    const activeConfig = config?.active;

    if (!activeConfig || typeof activeConfig !== "object") {
      return { configured: false, keyMissing: false, usingDefault: true };
    }

    let resolvedActiveKey: string | undefined = undefined;
    for (const [key, model] of Object.entries(models)) {
      if (deepEqual(model, activeConfig)) {
        resolvedActiveKey = key;
        break;
      }
    }

    const env = activeConfig.environment ?? {};
    const provider = activeConfig.provider;

    // Helper function to check if environment variable has a valid value
    const hasValidEnvVar = (key: string): boolean => {
      const value = env[key];
      return Boolean(value && typeof value === "string" && value.trim() !== "");
    };

    let hasValidCredentials: boolean = false;
    let providerSpecificValidation: boolean = false;

    // Check credentials based on provider type
    switch (provider) {
      case "ChatOpenAI":
        hasValidCredentials = hasValidEnvVar("OPENAI_API_KEY");
        providerSpecificValidation = true;
        break;

      case "AzureChatOpenAI":
        hasValidCredentials = hasValidEnvVar("AZURE_OPENAI_API_KEY");
        providerSpecificValidation = true;
        break;

      case "ChatBedrock": {
        const hasAwsRegion: boolean = hasValidEnvVar("AWS_DEFAULT_REGION");

        const hasExplicitCredentials: boolean =
          hasValidEnvVar("AWS_ACCESS_KEY_ID") && hasValidEnvVar("AWS_SECRET_ACCESS_KEY");
        hasValidCredentials = hasAwsRegion && hasExplicitCredentials;
        providerSpecificValidation = true;

        break;
      }

      case "ChatDeepSeek":
        hasValidCredentials = hasValidEnvVar("DEEPSEEK_API_KEY");
        providerSpecificValidation = true;
        break;

      case "ChatGoogleGenerativeAI":
        hasValidCredentials = hasValidEnvVar("GOOGLE_API_KEY");
        providerSpecificValidation = true;
        break;

      case "ChatOllama": {
        // Ollama doesn't require API keys, but needs model and baseUrl in args
        const args = activeConfig.args ?? {};
        hasValidCredentials = Boolean(args.model && args.baseUrl);
        providerSpecificValidation = true;
        break;
      }

      default:
        // Unknown provider - we can't validate but assume it might be configured
        hasValidCredentials = false;
        providerSpecificValidation = false;
        break;
    }

    // Check if using default OpenAI configuration
    const isUsingDefault =
      resolvedActiveKey === "OpenAI" &&
      provider === "ChatOpenAI" &&
      activeConfig?.args?.model === "gpt-4o" &&
      Object.values(env).every((v) => !v || (typeof v === "string" && v.trim() === ""));

    return {
      configured: hasValidCredentials,
      keyMissing: providerSpecificValidation && !hasValidCredentials,
      usingDefault: isUsingDefault,
      activeKey: resolvedActiveKey,
    };
  } catch (err) {
    console.error("Error parsing GenAI config:", err);
    return { configured: false, keyMissing: false, usingDefault: true };
  }
};

export const updateSolutionMaxEffortLevel = async (value: SolutionEffortLevel): Promise<void> => {
  await updateConfigValue("kai.getSolutionMaxEffort", value, vscode.ConfigurationTarget.Workspace);
};
export const updateGetSolutionMaxPriority = async (value: number | null): Promise<void> => {
  await updateConfigValue(
    "kai.getSolutionMaxPriority",
    value,
    vscode.ConfigurationTarget.Workspace,
  );
};
export const updateGetSolutionMaxDepth = async (value: number | null): Promise<void> => {
  await updateConfigValue("kai.getSolutionMaxDepth", value, vscode.ConfigurationTarget.Workspace);
};
export const updateKaiRpcServerPath = async (value: string | undefined): Promise<void> => {
  await updateConfigValue("kaiRpcServerPath", value, vscode.ConfigurationTarget.Workspace);
};
export const updateSolutionServerUrl = async (value: string | undefined): Promise<void> => {
  await updateConfigValue("solutionServer.url", value, vscode.ConfigurationTarget.Workspace);
};
export const updateSolutionServerEnabled = async (value: boolean): Promise<void> => {
  await updateConfigValue("solutionServer.enabled", value, vscode.ConfigurationTarget.Workspace);
};
export const updateAnalyzerPath = async (value: string | undefined): Promise<void> => {
  await updateConfigValue("analyzerPath", value, vscode.ConfigurationTarget.Workspace);
};

export const updateGetSolutionMaxIterations = async (value: number | null): Promise<void> => {
  await updateConfigValue(
    "kai.getSolutionMaxIterations",
    value,
    vscode.ConfigurationTarget.Workspace,
  );
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

export function updateConfigErrors(draft: ExtensionData, settingsPath: string): void {
  const genAIStatus = getProviderConfigStatus(settingsPath);
  const { activeProfileId, profiles } = draft;
  const profile = profiles.find((p) => p.id === activeProfileId);

  // Clear existing errors
  draft.configErrors = [];

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

  // Check provider configuration
  if (!genAIStatus.configured && genAIStatus.keyMissing) {
    draft.configErrors.push(createConfigError.providerKeyMissing());
  } else if (!genAIStatus.configured) {
    draft.configErrors.push(createConfigError.providerNotConfigured());
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

export const registerConfigChangeListener = (
  state: ExtensionState,
  settingsPath: string,
): vscode.Disposable => {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration("konveyor.kai.getSolutionMaxEffort") ||
      event.affectsConfiguration("konveyor.kai.getSolutionMaxLLMQueries") ||
      event.affectsConfiguration("konveyor.kai.getSolutionMaxPriority")
    ) {
      state.mutateData((draft) => {
        draft.solutionEffort = getConfigSolutionMaxEffortLevel();
        updateConfigErrors(draft, settingsPath);
      });
    }
  });
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
