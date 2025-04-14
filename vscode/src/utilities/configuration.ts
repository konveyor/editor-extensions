import * as vscode from "vscode";
import * as yaml from "js-yaml";
import * as fs from "fs";
import deepEqual from "fast-deep-equal";
import { ServerLogLevels } from "../client/types";
import { KONVEYOR_CONFIG_KEY } from "./constants";
import { ExtensionState } from "../extensionState";
import {
  AnalysisProfile,
  ExtensionData,
  GenAIConfigFile,
  GenAIConfigStatus,
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
export const getConfigUseDefaultRulesets = (): boolean =>
  getConfigValue<boolean>("analysis.useDefaultRulesets") ?? true;
export const getConfigCustomRules = (): string[] => [
  ...(getConfigValue<string[]>("analysis.customRules") || []),
];
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
export const getConfigPromptTemplate = (): string =>
  getConfigValue<string>("kai.promptTemplate") ??
  "Help me address this Konveyor migration issue:\nRule: {{ruleset_name}} - {{ruleset_description}}\nViolation: {{violation_name}} - {{violation_description}}\nCategory: {{violation_category}}\nMessage: {{message}}";

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

export const getGenAIConfigStatus = (filepath: string): GenAIConfigStatus => {
  try {
    const fileContents = fs.readFileSync(filepath, "utf8");
    const config = yaml.load(fileContents) as GenAIConfigFile;
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
    const apiKey = env.OPENAI_API_KEY?.trim?.();

    return {
      configured: Boolean(apiKey),
      keyMissing: !apiKey,
      usingDefault:
        resolvedActiveKey === "OpenAI" &&
        activeConfig?.args?.model === "gpt-4o" &&
        Object.values(env).every((v) => !v || v.trim() === ""),
      activeKey: resolvedActiveKey,
    };
  } catch (err) {
    console.error("Error parsing GenAI config:", err);
    return { configured: false, keyMissing: false, usingDefault: true };
  }
};

export function updateAnalysisConfig(draft: ExtensionData, settingsPath: string): void {
  const currentLabelSelector = getConfigLabelSelector();
  const customRules = getConfigCustomRules();
  const UNCONFIGURED_VALUES = [undefined, "discovery", "(discovery)"];
  const status = getGenAIConfigStatus(settingsPath);

  draft.analysisConfig = {
    labelSelectorValid: !UNCONFIGURED_VALUES.includes(currentLabelSelector),
    genAIConfigured: status.configured,
    genAIKeyMissing: status.keyMissing,
    genAIUsingDefault: status.usingDefault,
    customRulesConfigured: customRules.length > 0,
  };
}

export const getConfigProfiles = (): AnalysisProfile[] =>
  getConfigValue<AnalysisProfile[]>("profiles")?.map((p) => ({
    ...p,
    customRules: [...p.customRules],
  })) || [];

export const getConfigActiveProfileName = (): string =>
  getConfigValue<string>("activeProfileName") || "";

export const updateConfigProfiles = async (profiles: AnalysisProfile[]): Promise<void> => {
  await updateConfigValue("profiles", profiles, vscode.ConfigurationTarget.Workspace);
};

export const updateConfigActiveProfileName = async (profileName: string): Promise<void> => {
  await updateConfigValue("activeProfileName", profileName, vscode.ConfigurationTarget.Workspace);
};

export const registerConfigChangeListener = (
  state: ExtensionState,
  settingsPath: string,
): vscode.Disposable => {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    let needsUpdate = false;

    if (
      event.affectsConfiguration("konveyor.kai.getSolutionMaxEffort") ||
      event.affectsConfiguration("konveyor.analysis.labelSelector") ||
      event.affectsConfiguration("konveyor.analysis.customRules")
    ) {
      needsUpdate = true;
    }

    if (needsUpdate) {
      state.mutateData((draft) => {
        draft.solutionEffort = getConfigSolutionMaxEffortLevel();
        updateAnalysisConfig(draft, settingsPath);
      });
    }
  });
};
