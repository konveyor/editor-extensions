import * as vscode from "vscode";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { ServerLogLevels } from "../client/types";
import { KONVEYOR_CONFIG_KEY } from "./constants";
import { ExtensionData } from "@editor-extensions/shared";
import { effortLevels, getEffortValue, SolutionEffortLevel } from "@editor-extensions/shared";

function getConfigValue<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration(KONVEYOR_CONFIG_KEY)?.get<T>(key);
}

export function getConfigAnalyzerPath(): string {
  return getConfigValue<string>("analyzerPath") || "";
}

export function getConfigKaiRpcServerPath(): string {
  return getConfigValue<string>("kaiRpcServerPath") || "";
}

export function getConfigLogLevel(): ServerLogLevels {
  return getConfigValue<ServerLogLevels>("logLevel") || "DEBUG";
}

export function getConfigLoggingTraceMessageConnection(): boolean {
  return getConfigValue<boolean>("logging.traceMessageConnection") ?? false;
}

export function getConfigIncidentLimit(): number {
  return getConfigValue<number>("analysis.incidentLimit") || 10000;
}

export function getConfigContextLines(): number {
  return getConfigValue<number>("analysis.contextLines") || 10;
}

export function getConfigCodeSnipLimit(): number {
  return getConfigValue<number>("analysis.codeSnipLimit") || 10;
}

export function getConfigUseDefaultRulesets(): boolean {
  return getConfigValue<boolean>("analysis.useDefaultRulesets") ?? true;
}

export function getConfigCustomRules(): string[] {
  return getConfigValue<string[]>("analysis.customRules") || [];
}

export function getConfigLabelSelector(): string {
  return getConfigValue<string>("analysis.labelSelector") || "discovery";
}

export function getConfigAnalyzeKnownLibraries(): boolean {
  return getConfigValue<boolean>("analysis.analyzeKnownLibraries") ?? false;
}

export function getConfigAnalyzeDependencies(): boolean {
  return getConfigValue<boolean>("analysis.analyzeDependencies") ?? true;
}

export function getConfigAnalyzeOnSave(): boolean {
  return getConfigValue<boolean>("analysis.analyzeOnSave") ?? true;
}

export function getConfigDiffEditorType(): string {
  return getConfigValue<"diff" | "merge">("diffEditorType") || "diff";
}

export function getCacheDir(): string | undefined {
  return getConfigValue<string>("kai.cacheDir");
}

export function getTraceEnabled(): boolean {
  return getConfigValue<boolean>("kai.traceEnabled") || false;
}

export function getConfigKaiDemoMode(): boolean {
  return getConfigValue<boolean>("kai.demoMode") ?? false;
}

async function updateConfigValue<T>(
  key: string,
  value: T | undefined,
  scope: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
): Promise<void> {
  await vscode.workspace.getConfiguration(KONVEYOR_CONFIG_KEY).update(key, value, scope);
}

export async function updateAnalyzerPath(value: string | undefined): Promise<void> {
  try {
    const scope = vscode.workspace.workspaceFolders
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await updateConfigValue("analyzerPath", value, scope);
  } catch (error) {
    console.error("Failed to update analyzerPath:", error);
  }
}

export async function updateKaiRpcServerPath(value: string | undefined): Promise<void> {
  try {
    const scope = vscode.workspace.workspaceFolders
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    await updateConfigValue("kaiRpcServerPath", value, scope);
  } catch (error) {
    console.error("Failed to update kaiRpcServerPath:", error);
  }
}

export async function updateLogLevel(value: string): Promise<void> {
  await updateConfigValue("logLevel", value, vscode.ConfigurationTarget.Workspace);
}

export async function updateIncidentLimit(value: number): Promise<void> {
  await updateConfigValue("analysis.incidentLimit", value, vscode.ConfigurationTarget.Workspace);
}

export async function updateContextLines(value: number): Promise<void> {
  await updateConfigValue("analysis.contextLines", value, vscode.ConfigurationTarget.Workspace);
}

export async function updateCodeSnipLimit(value: number): Promise<void> {
  await updateConfigValue("analysis.codeSnipLimit", value, vscode.ConfigurationTarget.Workspace);
}

export async function updateUseDefaultRuleSets(value: boolean): Promise<void> {
  await updateConfigValue(
    "analysis.useDefaultRulesets",
    value,
    vscode.ConfigurationTarget.Workspace,
  );
}

export async function updateCustomRules(value: string[]): Promise<void> {
  await updateConfigValue("analysis.customRules", value, vscode.ConfigurationTarget.Workspace);
}

export async function updateLabelSelector(value: string): Promise<void> {
  await updateConfigValue("analysis.labelSelector", value, vscode.ConfigurationTarget.Workspace);
}

export async function updateAnalyzeKnownLibraries(value: boolean): Promise<void> {
  await updateConfigValue(
    "analysis.analyzeKnownLibraries",
    value,
    vscode.ConfigurationTarget.Workspace,
  );
}

export async function updateAnalyzeDependencies(value: boolean): Promise<void> {
  await updateConfigValue(
    "analysis.analyzeDependencies",
    value,
    vscode.ConfigurationTarget.Workspace,
  );
}

export async function updateAnalyzeOnSave(value: boolean): Promise<void> {
  await updateConfigValue("analysis.analyzeOnSave", value, vscode.ConfigurationTarget.Workspace);
}

export function getConfigSolutionMaxPriority(): number | undefined {
  return getConfigValue<number | null>("kai.getSolutionMaxPriority") ?? undefined;
}

// getConfigSolutionMaxEffort takes the enum from the config and turns it into
// a number for use in a getSolution request. This value corresponds to
// the maximum depth kai will go in attempting to provide a solution.
export function getConfigSolutionMaxEffortValue(): number | undefined {
  const effortLevel = getConfigValue<string>("kai.getSolutionMaxEffort");

  if (effortLevel && effortLevel in effortLevels) {
    return getEffortValue(effortLevel as SolutionEffortLevel);
  }

  return 0;
}

export function getConfigSolutionMaxEffortLevel(): SolutionEffortLevel {
  return getConfigValue<string>("kai.getSolutionMaxEffort") as SolutionEffortLevel;
}

export function getConfigMaxLLMQueries(): number | undefined {
  return getConfigValue<number | null>("kai.getSolutionMaxLLMQueries") ?? undefined;
}

export async function updateGetSolutionMaxPriority(value: number): Promise<void> {
  await updateConfigValue(
    "kai.getSolutionMaxPriority",
    value,
    vscode.ConfigurationTarget.Workspace,
  );
}

export async function updateGetSolutionMaxDepth(value: number): Promise<void> {
  await updateConfigValue("kai.getSolutionMaxDepth", value, vscode.ConfigurationTarget.Workspace);
}

export async function updateGetSolutionMaxIterations(value: number): Promise<void> {
  await updateConfigValue(
    "kai.getSolutionMaxIterations",
    value,
    vscode.ConfigurationTarget.Workspace,
  );
}

export function isGenAIConfigured(filepath: string): boolean {
  try {
    const fileContents = fs.readFileSync(filepath, "utf8");
    const config = yaml.load(fileContents) as any;

    const activeModel = config?.active;
    const models = config?.models ?? {};

    const activeConfig = Object.values(models).find(
      (model: any) => model && model === activeModel,
    ) as any;

    const hasApiKey =
      activeConfig?.environment &&
      Object.values(activeConfig.environment).some((val: any) => val?.trim() !== "");

    return Boolean(hasApiKey);
  } catch (err) {
    console.error("Error reading GenAI config:", err);
    return false;
  }
}

interface GenAIConfigStatus {
  configured: boolean;
  keyMissing: boolean;
  usingDefault: boolean;
}

interface GenAIConfigStatus {
  configured: boolean;
  keyMissing: boolean;
  usingDefault: boolean;
  activeKey?: string;
}

// Deep compare two plain objects (arrays and functions not needed here)
function deepEqual(a: any, b: any): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }

  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }

  for (const key of aKeys) {
    /*eslint-disable-next-line no-prototype-builtins*/
    if (!b.hasOwnProperty(key)) {
      return false;
    }
    if (!deepEqual(a[key], b[key])) {
      return false;
    }
  }

  return true;
}

export function getGenAIConfigStatus(filepath: string): GenAIConfigStatus {
  try {
    const fileContents = fs.readFileSync(filepath, "utf8");
    const config = yaml.load(fileContents) as any;

    const models = config?.models ?? {};
    const activeConfig = config?.active;

    if (!activeConfig || typeof activeConfig !== "object") {
      return { configured: false, keyMissing: false, usingDefault: true };
    }

    // Manually find the model key whose value matches the active config
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
      keyMissing: apiKey === "" || apiKey === undefined,
      usingDefault:
        resolvedActiveKey === "OpenAI" &&
        activeConfig?.args?.model === "gpt-4o" &&
        Object.values(env).every((v: any) => !v || v.trim() === ""),
      activeKey: resolvedActiveKey,
    };
  } catch (err) {
    console.error("Error parsing GenAI config:", err);
    return { configured: false, keyMissing: false, usingDefault: true };
  }
}

export function updateAnalysisConfig(draft: ExtensionData, settingsPath: string): void {
  const config = vscode.workspace.getConfiguration("konveyor.analysis");
  const labelSelector = config.get<string>("labelSelector");
  const UNCONFIGURED_VALUES = [undefined, "discovery", "(discovery)"];
  const status = getGenAIConfigStatus(settingsPath);

  draft.analysisConfig = {
    labelSelectorValid: !UNCONFIGURED_VALUES.includes(labelSelector),
    genAIConfigured: status.configured,
    genAIKeyMissing: status.keyMissing,
    genAIUsingDefault: status.usingDefault,
    customRulesConfigured: false,
  };
}
