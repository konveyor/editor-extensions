import { ExtensionState } from "src/extensionState";
import { OpenDialogOptions, window } from "vscode";
import { getUserProfiles, saveUserProfiles } from "./profileService";
import { updateConfigErrors } from "../configuration";

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

  state.mutateProfiles((draft) => {
    const target = draft.profiles.find((p) => p.id === updated.id);
    if (target) {
      Object.assign(target, updated);
    }
  });

  // Re-validate config errors to clear "no custom rules" error if applicable
  state.mutateConfigErrors((draft) => {
    // Clear existing profile-related errors and re-validate using centralized logic
    draft.configErrors = draft.configErrors.filter(
      (error) => error.type !== "invalid-label-selector" && error.type !== "no-custom-rules",
    );
    updateConfigErrors(draft, "");
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
