import { ExtensionState } from "src/extensionState";
import { OpenDialogOptions, window } from "vscode";
import { getUserProfiles, saveUserProfiles } from "./profileService";

// profileActions.ts
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
  const useDefaultRulesets = await window.showQuickPick(["Yes", "No"], {
    placeHolder: "Use default rulesets?",
    canPickMany: false,
  });

  if (!useDefaultRulesets) {
    return;
  }

  const profile = state.data.profiles.find((p) => p.id === profileId);
  if (!profile) {
    window.showErrorMessage("No active profile.");
    return;
  }

  const updated = {
    ...profile,
    customRules,
    useDefaultRules: useDefaultRulesets === "Yes",
  };

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
}
