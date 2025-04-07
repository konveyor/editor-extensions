import { ExtensionState } from "../extensionState";
import { AnalysisProfile } from "@editor-extensions/shared";
import { updateConfigProfiles, updateConfigActiveProfileName } from "../utilities/configuration";

export async function addProfile(profile: AnalysisProfile, state: ExtensionState): Promise<void> {
  const profiles = [...state.data.profiles, { ...profile }];
  state.mutateData((draft) => {
    draft.profiles = profiles;
    draft.activeProfileName = profile.name;
  });
  await updateConfigProfiles(profiles);
  await updateConfigActiveProfileName(profile.name);
}

export async function deleteProfile(name: string, state: ExtensionState): Promise<void> {
  const profiles = state.data.profiles.filter((p) => p.name !== name);
  state.mutateData((draft) => {
    draft.profiles = profiles;
  });
  await updateConfigProfiles(profiles);
}

export async function updateProfile(
  originalName: string,
  updatedProfile: AnalysisProfile,
  state: ExtensionState,
): Promise<void> {
  const updatedProfiles = state.data.profiles.map((p) =>
    p.name === originalName
      ? { ...updatedProfile, customRules: [...updatedProfile.customRules] }
      : { ...p },
  );

  state.mutateData((draft) => {
    draft.profiles = updatedProfiles;
    draft.activeProfileName = updatedProfile.name;
  });

  await updateConfigProfiles(updatedProfiles);
  await updateConfigActiveProfileName(updatedProfile.name);
}

export async function setActiveProfile(name: string, state: ExtensionState): Promise<void> {
  state.mutateData((draft) => {
    draft.activeProfileName = name;
  });
  await updateConfigActiveProfileName(name);
}
