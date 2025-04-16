import * as vscode from "vscode";
import { AnalysisProfile } from "@editor-extensions/shared";
import { ExtensionState } from "../extensionState";

const USER_PROFILE_KEY = "userProfiles";

export function getUserProfiles(context: vscode.ExtensionContext): AnalysisProfile[] {
  return context.globalState.get<AnalysisProfile[]>(USER_PROFILE_KEY) ?? [];
}

export function saveUserProfiles(
  context: vscode.ExtensionContext,
  profiles: AnalysisProfile[],
): void {
  context.globalState.update(USER_PROFILE_KEY, profiles);
}

export async function setActiveProfileId(profileId: string, state: ExtensionState): Promise<void> {
  await state.extensionContext.workspaceState.update("activeProfileId", profileId);
  state.mutateData((draft) => {
    draft.activeProfileId = profileId;
  });
}
