import { AnalysisProfile } from "@editor-extensions/shared";
import {
  getConfigProfiles,
  updateConfigProfiles,
  updateConfigActiveProfileName,
} from "../utilities/configuration";

/**
 * Add a new profile and make it active.
 */
export async function addProfile(profile: AnalysisProfile): Promise<void> {
  const currentProfiles = getConfigProfiles();
  const updated = [...currentProfiles, { ...profile, customRules: [...profile.customRules] }];
  await updateConfigProfiles(updated);
  await updateConfigActiveProfileName(profile.name);
}

/**
 * Remove a profile by name.
 */
export async function deleteProfile(name: string): Promise<void> {
  const currentProfiles = getConfigProfiles();
  const updated = currentProfiles.filter((p) => p.name !== name);
  await updateConfigProfiles(updated);
}

/**
 * Update a profile by replacing it with a new version (by original name).
 */
export async function updateProfile(
  originalName: string,
  updatedProfile: AnalysisProfile,
): Promise<void> {
  const currentProfiles = getConfigProfiles();
  const updated = currentProfiles.map((p) =>
    p.name === originalName
      ? { ...updatedProfile, customRules: [...updatedProfile.customRules] }
      : { ...p, customRules: [...p.customRules] },
  );
  await updateConfigProfiles(updated);
  await updateConfigActiveProfileName(updatedProfile.name);
}

/**
 * Set active profile name.
 */
export async function setActiveProfile(name: string): Promise<void> {
  await updateConfigActiveProfileName(name);
}
