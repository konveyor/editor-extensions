import { ExtensionState } from "src/extensionState";
import { OpenDialogOptions, window } from "vscode";
import { getUserProfiles, saveUserProfiles } from "./profileService";

export async function handleConfigureCustomRules(profileId: string, state: ExtensionState) {
  const options: OpenDialogOptions = {
    canSelectMany: true,
    canSelectFolders: true,
    canSelectFiles: true,
    openLabel: "Select Custom Rules",
    filters: { "All Files": ["*"] },
  };

  const fileUris = await window.showOpenDialog(options);
  if (!fileUris || fileUris.length === 0) {
    return;
  }

  const customRules = fileUris.map((uri) => uri.fsPath);

  const profile = state.data.profiles.find((p) => p.id === profileId);
  if (!profile) {
    window.showErrorMessage("No active profile.");
    return;
  }

  const updated = {
    ...profile,
    customRules: Array.from(new Set([...(profile.customRules ?? []), ...customRules])),
  };

  // Check if this is the active profile
  const isActiveProfile = state.data.activeProfileId === profileId;

  const userProfiles = getUserProfiles(state.extensionContext).map((p) =>
    p.id === updated.id ? updated : p,
  );
  await saveUserProfiles(state.extensionContext, userProfiles);

  state.mutateData((draft) => {
    const target = draft.profiles.find((p) => p.id === updated.id);
    if (target) {
      Object.assign(target, updated);
    }
  });

  window.showInformationMessage(`Updated custom rules for "${updated.name}"`);

  // Stop the analyzer server if we modified the active profile's custom rules
  // This ensures the custom rules changes take effect on next analysis
  if (isActiveProfile && state.analyzerClient.isServerRunning()) {
    state.logger.info(
      "Custom rules updated for active profile, stopping analyzer server to apply changes",
    );
    await state.analyzerClient.stop();
    window.showInformationMessage(
      "Custom rules updated. Analyzer server stopped. Please restart the server to apply changes.",
    );
  }
}
