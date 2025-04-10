import * as vscode from "vscode";
import { AnalysisProfile } from "../../../shared/dist/types";
import { ExtensionState } from "../extensionState";

const PROFILES_KEY = "analysis.profiles";

export async function getProfiles(context: vscode.ExtensionContext): Promise<AnalysisProfile[]> {
  return context.globalState.get<AnalysisProfile[]>(PROFILES_KEY, []);
}

export async function saveProfiles(context: vscode.ExtensionContext, profiles: AnalysisProfile[]) {
  return context.globalState.update(PROFILES_KEY, profiles);
}

export async function getActiveProfile(context: vscode.ExtensionContext): Promise<string> {
  return context.globalState.get<string>("analysis.activeProfile") ?? "";
}

export async function setActiveProfile(context: vscode.ExtensionContext, profileName: string) {
  return context.globalState.update("analysis.activeProfile", profileName);
}

export async function updateActiveProfile(state: ExtensionState, profileName: string) {
  await setActiveProfile(state.extensionContext, profileName);
  state.mutateData((draft) => {
    draft.activeProfileName = profileName;
  });
}
