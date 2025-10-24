import * as vscode from "vscode";
import { AnalysisProfile } from "@editor-extensions/shared";
import { ExtensionState } from "../../extensionState";
import { getBundledProfiles } from "./bundledProfiles";
import { discoverInTreeProfiles } from "./inTreeProfiles";

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
  state.mutateProfiles((draft) => {
    draft.profiles = [...getBundledProfiles(), ...userProfiles];
    draft.activeProfileId = activeId;
  });
}

export async function setActiveProfileId(profileId: string, state: ExtensionState): Promise<void> {
  await state.extensionContext.workspaceState.update(ACTIVE_PROFILE_KEY, profileId);
  state.mutateProfiles((draft) => {
    draft.activeProfileId = profileId;
  });
}

export function getActiveProfileId(context: vscode.ExtensionContext): string | undefined {
  return context.workspaceState.get<string>(ACTIVE_PROFILE_KEY);
}

export async function getAllProfiles(context: vscode.ExtensionContext): Promise<AnalysisProfile[]> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  // If in-tree profiles exist, ONLY return those (IN-TREE ALWAYS WINS)
  if (workspaceRoot) {
    const inTreeProfiles = await discoverInTreeProfiles(workspaceRoot);
    if (inTreeProfiles.length > 0) {
      return inTreeProfiles;
    }
  }

  // Fallback to existing behavior
  const bundled = getBundledProfiles();
  const user = getUserProfiles(context);
  return [...bundled, ...user];
}

export async function getActiveProfile(
  state: ExtensionState,
): Promise<AnalysisProfile | undefined> {
  const activeId = state.data.activeProfileId;
  if (!activeId) {
    return undefined;
  }
  const allProfiles = await getAllProfiles(state.extensionContext);
  const activeProfile = allProfiles.find((p) => p.id === activeId);
  if (!activeProfile) {
    console.error(`Active profile with ID ${activeId} not found.`);
    return undefined;
  }
  return activeProfile;
}

export async function getLabelSelector(state: ExtensionState): Promise<string> {
  const profile = await getActiveProfile(state);
  return profile?.labelSelector ?? "(discovery)";
}

export async function getCustomRules(state: ExtensionState): Promise<string[]> {
  const profile = await getActiveProfile(state);
  return profile?.customRules ?? [];
}

export async function getUseDefaultRules(state: ExtensionState): Promise<boolean> {
  const profile = await getActiveProfile(state);
  return profile?.useDefaultRules ?? true;
}

export function updateActiveProfile(
  state: ExtensionState,
  updateFn: (profile: AnalysisProfile) => AnalysisProfile,
): void {
  state.mutateProfiles((draft) => {
    const idx = draft.profiles.findIndex((p) => p.id === draft.activeProfileId);
    if (idx !== -1) {
      draft.profiles[idx] = updateFn(draft.profiles[idx]);
    }
  });
}
