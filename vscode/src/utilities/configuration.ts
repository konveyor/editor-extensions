import { KONVEYOR_CONFIG_KEY } from "./constants";
import * as vscode from "vscode";

function getConfigValue<T>(key: string): T | undefined {
  return vscode.workspace.getConfiguration(KONVEYOR_CONFIG_KEY)?.get<T>(key);
}

export function getConfigAnalyzerPath(): string {
  return getConfigValue<string>("analyzerPath") || "";
}

export function getConfigKaiRpcServerPath(): string {
  return getConfigValue<string>("kaiRpcServerPath") || "";
}

export function getConfigLogLevel(): string {
  return getConfigValue<string>("logLevel") || "debug";
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
  return getConfigValue<string>("diffEditorType") || "diff";
}

export function getConfigKaiBackendURL(): string {
  return getConfigValue<string>("kai.backendURL") || "0.0.0.0:8080";
}

export function getConfigKaiProviderName(): string {
  return getConfigValue<string>("kai.providerName") || "ChatIBMGenAI";
}

export function getConfigKaiProviderArgs(): object {
  return getConfigValue<object>("kai.providerArgs") || {};
}

async function updateConfigValue<T>(
  key: string,
  value: T | undefined,
  scope: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
): Promise<void> {
  await vscode.workspace.getConfiguration(KONVEYOR_CONFIG_KEY).update(key, value, scope);
}

export async function updateAnalyzerPath(value: string | undefined): Promise<void> {
  await updateConfigValue("analyzerPath", value, vscode.ConfigurationTarget.Workspace);
}

export async function updateKaiRpcServerPath(value: string | undefined): Promise<void> {
  await updateConfigValue("kaiRpcServerPath", value, vscode.ConfigurationTarget.Workspace);
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
