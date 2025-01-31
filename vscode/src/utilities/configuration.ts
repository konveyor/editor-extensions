import * as vscode from "vscode";
import { ServerLogLevels } from "../client/types";
import { KONVEYOR_CONFIG_KEY } from "./constants";

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

export function getConfigKaiProviderName(): string {
  return getConfigValue<string>("kai.providerName") || "ChatIBMGenAI";
}

export function getCacheDir(): string | undefined {
  return getConfigValue<string>("kai.cacheDir");
}

export function getTraceEnabled(): boolean {
  return getConfigValue<boolean>("kai.traceEnabled") || false;
}

export function getConfigKaiProviderArgs(): object | undefined {
  const config = vscode.workspace.getConfiguration("konveyor.kai");
  const providerArgsConfig = config.inspect<object>("providerArgs");

  if (!providerArgsConfig) {
    console.log("No configuration found for providerArgs.");
    return undefined;
  }

  const userDefinedValue =
    providerArgsConfig.globalValue !== undefined ||
    providerArgsConfig.workspaceValue !== undefined ||
    providerArgsConfig.workspaceFolderValue !== undefined;

  if (userDefinedValue) {
    if (providerArgsConfig.workspaceFolderValue) {
      console.log("Using workspaceFolder providerArgs:", providerArgsConfig.workspaceFolderValue);
      return providerArgsConfig.workspaceFolderValue;
    }
    if (providerArgsConfig.workspaceValue) {
      console.log("Using workspace providerArgs:", providerArgsConfig.workspaceValue);
      return providerArgsConfig.workspaceValue;
    }
    if (providerArgsConfig.globalValue) {
      console.log("Using global providerArgs:", providerArgsConfig.globalValue);
      return providerArgsConfig.globalValue;
    }
  }

  console.log("No user overrides for providerArgs. Using defaults from package.json.");
  return undefined;
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

export async function updateKaiProviderName(value: string): Promise<void> {
  await updateConfigValue("kai.providerName", value, vscode.ConfigurationTarget.Workspace);
}

export async function updateKaiProviderModel(value: string): Promise<void> {
  await updateConfigValue("kai.providerModel", value, vscode.ConfigurationTarget.Workspace);
}

export async function getGenAiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  try {
    const key = await context.secrets.get("genAiKey");

    if (!key) {
      await vscode.window.showWarningMessage("No GenAI key found in secure storage.");
      return undefined;
    }

    return key;
  } catch (error: any) {
    console.error("Failed to retrieve GenAI key:", error);
    await vscode.window.showErrorMessage("An error occurred while retrieving the GenAI key.");
    return undefined;
  }
}

export async function updateGenAiKey(
  context: vscode.ExtensionContext,
  newKey: string | undefined,
): Promise<void> {
  if (newKey) {
    await context.secrets.store("genAiKey", newKey);
    vscode.window.showInformationMessage("Key stored securely.");
  } else {
    await context.secrets.delete("genAiKey");
    vscode.window.showInformationMessage("Key removed.");
  }
}

export function getConfigSolutionMaxPriority(): number | undefined {
  return getConfigValue<number | null>("kai.getSolutionMaxPriority") ?? undefined;
}

// getConfigSolutionMaxEffort takes the enum from the config and turns it into
// a number for use in a getSolution request. This value corresponds to
// the maximum depth kai will go in attempting to provide a solution.
export function getConfigSolutionMaxEffort(): number | undefined {
  const effortLevels: Record<string, number | undefined> = {
    Low: 0,
    Medium: 1,
    "Maximum (experimental)": undefined,
  };

  const effortSetting = getConfigValue<string>("kai.getSolutionMaxEffort");
  return effortLevels[effortSetting as keyof typeof effortLevels] ?? 0;
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
