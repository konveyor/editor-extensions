import * as vscode from "vscode";
import { AnalysisProfile } from "@editor-extensions/shared";
import { ExtensionState } from "../../extensionState";
import { getBundledProfiles } from "./bundledProfiles";

const USER_PROFILE_KEY = "userProfiles";
const ACTIVE_PROFILE_KEY = "activeProfileId";

export function getUserProfiles(context: vscode.ExtensionContext): AnalysisProfile[] {
  return context.globalState.get<AnalysisProfile[]>(USER_PROFILE_KEY) ?? [];
}

export function saveUserProfiles(
  context: vscode.ExtensionContext,
  profiles: AnalysisProfile[],
): void {
  context.globalState.update(USER_PROFILE_KEY, profiles);
}

export async function saveProfilesAndActiveId(
  context: vscode.ExtensionContext,
  state: ExtensionState,
  userProfiles: AnalysisProfile[],
  activeId: string,
) {
  await context.globalState.update(USER_PROFILE_KEY, userProfiles);
  await context.workspaceState.update("activeProfileId", activeId);
  state.mutateData((draft) => {
    draft.profiles = [...getBundledProfiles(), ...userProfiles];
    draft.activeProfileId = activeId;
  });
}

export async function setActiveProfileId(profileId: string, state: ExtensionState): Promise<void> {
  await state.extensionContext.workspaceState.update(ACTIVE_PROFILE_KEY, profileId);
  state.mutateData((draft) => {
    draft.activeProfileId = profileId;
  });
}

export function getActiveProfileId(context: vscode.ExtensionContext): string | undefined {
  return context.workspaceState.get<string>(ACTIVE_PROFILE_KEY);
}

export function getAllProfiles(context: vscode.ExtensionContext): AnalysisProfile[] {
  const bundled = getBundledProfiles();
  const user = getUserProfiles(context);
  return [...bundled, ...user];
}

export function getActiveProfile(state: ExtensionState): AnalysisProfile | undefined {
  const activeId = state.data.activeProfileId;
  if (!activeId) {
    return undefined;
  }
  const allProfiles = getAllProfiles(state.extensionContext);
  const activeProfile = allProfiles.find((p) => p.id === activeId);
  if (!activeProfile) {
    console.error(`Active profile with ID ${activeId} not found.`);
    return undefined;
  }
  return activeProfile;
}

export function getLabelSelector(state: ExtensionState): string {
  return getActiveProfile(state)?.labelSelector ?? "(discovery)";
}

export function getCustomRules(state: ExtensionState): string[] {
  return getActiveProfile(state)?.customRules ?? [];
}

export function getUseDefaultRules(state: ExtensionState): boolean {
  return getActiveProfile(state)?.useDefaultRules ?? true;
}

export function updateActiveProfile(
  state: ExtensionState,
  updateFn: (profile: AnalysisProfile) => AnalysisProfile,
): void {
  state.mutateData((draft) => {
    const idx = draft.profiles.findIndex((p) => p.id === draft.activeProfileId);
    if (idx !== -1) {
      draft.profiles[idx] = updateFn(draft.profiles[idx]);
    }
  });
}

export function buildLabelSelector(sources: string[], targets: string[]): string {
  const sourcesPart = sources.map((s) => `konveyor.io/source=${s}`).join(" || ");
  const targetsPart = targets.map((t) => `konveyor.io/target=${t}`).join(" || ");
  return sourcesPart || targetsPart
    ? `(${[sourcesPart, targetsPart].filter(Boolean).join(" && ")}) || (discovery)`
    : "(discovery)";
}
