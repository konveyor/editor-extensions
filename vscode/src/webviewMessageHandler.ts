import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import {
  ADD_PROFILE,
  AnalysisProfile,
  APPLY_FILE,
  CONFIGURE_CUSTOM_RULES,
  CONFIGURE_LABEL_SELECTOR,
  CONFIGURE_SOURCES_TARGETS,
  DELETE_PROFILE,
  DISCARD_FILE,
  GET_SOLUTION,
  GET_SOLUTION_WITH_KONVEYOR_CONTEXT,
  LocalChange,
  OPEN_FILE,
  OPEN_GENAI_SETTINGS,
  OVERRIDE_ANALYZER_BINARIES,
  OVERRIDE_RPC_SERVER_BINARIES,
  OPEN_PROFILE_MANAGER,
  RUN_ANALYSIS,
  Scope,
  SET_ACTIVE_PROFILE,
  START_SERVER,
  STOP_SERVER,
  UPDATE_PROFILE,
  VIEW_FIX,
  WEBVIEW_READY,
  WebviewAction,
  WebviewActionType,
  ScopeWithKonveyorContext,
  ExtensionData,
} from "@editor-extensions/shared";

import { getBundledProfiles } from "./utilities/profiles/bundledProfiles";
import {
  getUserProfiles,
  saveUserProfiles,
  setActiveProfileId,
} from "./utilities/profiles/profileService";

export function setupWebviewMessageListener(webview: vscode.Webview, state: ExtensionState) {
  webview.onDidReceiveMessage(async (message) => {
    await messageHandler(message, state);
  });
}

const actions: {
  [name: string]: (payload: any, state: ExtensionState) => void | Promise<void>;
} = {
  [ADD_PROFILE]: async (profile: AnalysisProfile, state) => {
    const userProfiles = getUserProfiles(state.extensionContext);

    if (userProfiles.some((p) => p.name === profile.name)) {
      vscode.window.showErrorMessage(`A profile named "${profile.name}" already exists.`);
      return;
    }

    const updated = [...userProfiles, profile];
    saveUserProfiles(state.extensionContext, updated);

    const allProfiles = [...getBundledProfiles(), ...updated];
    setActiveProfileId(profile.id, state);

    state.mutateData((draft) => {
      draft.profiles = allProfiles;
      draft.activeProfileId = profile.id;
      updateAnalysisConfigFromActiveProfile(draft);
    });
  },

  [DELETE_PROFILE]: async (profileId: string, state) => {
    const userProfiles = getUserProfiles(state.extensionContext);
    const filtered = userProfiles.filter((p) => p.id !== profileId);

    saveUserProfiles(state.extensionContext, filtered);

    const fullProfiles = [...getBundledProfiles(), ...filtered];
    state.mutateData((draft) => {
      draft.profiles = fullProfiles;

      if (draft.activeProfileId === profileId) {
        draft.activeProfileId = fullProfiles[0]?.id ?? "";
        state.extensionContext.workspaceState.update("activeProfileId", draft.activeProfileId);
      }
      updateAnalysisConfigFromActiveProfile(draft);
    });
  },

  [UPDATE_PROFILE]: async ({ originalId, updatedProfile }, state) => {
    const allProfiles = [...getBundledProfiles(), ...getUserProfiles(state.extensionContext)];
    const isBundled = allProfiles.find((p) => p.id === originalId)?.readOnly;

    if (isBundled) {
      vscode.window.showWarningMessage(
        "Built-in profiles cannot be edited. Copy it to a new profile first.",
      );
      return;
    }

    const updatedList = allProfiles.map((p) =>
      p.id === originalId ? { ...p, ...updatedProfile } : p,
    );

    const userProfiles = updatedList.filter((p) => !p.readOnly);
    saveUserProfiles(state.extensionContext, userProfiles);

    const fullProfiles = [...getBundledProfiles(), ...userProfiles];
    state.mutateData((draft) => {
      draft.profiles = fullProfiles;

      if (draft.activeProfileId === originalId) {
        draft.activeProfileId = updatedProfile.id;
      }
      updateAnalysisConfigFromActiveProfile(draft);
    });
  },

  [SET_ACTIVE_PROFILE]: async (profileId: string, state) => {
    const allProfiles = [...getBundledProfiles(), ...getUserProfiles(state.extensionContext)];
    const valid = allProfiles.find((p) => p.id === profileId);
    if (!valid) {
      vscode.window.showErrorMessage(`Cannot set active profile. Profile not found.`);
      return;
    }
    setActiveProfileId(profileId, state);
    state.mutateData((draft) => {
      draft.activeProfileId = profileId;
      updateAnalysisConfigFromActiveProfile(draft);
    });
  },

  [OPEN_PROFILE_MANAGER]() {
    vscode.commands.executeCommand("konveyor.openProfilesPanel");
  },
  [WEBVIEW_READY]() {
    console.log("Webview is ready");
  },
  [CONFIGURE_SOURCES_TARGETS]() {
    vscode.commands.executeCommand("konveyor.configureSourcesTargets");
  },
  [CONFIGURE_LABEL_SELECTOR]() {
    vscode.commands.executeCommand("konveyor.configureLabelSelector");
  },
  [CONFIGURE_CUSTOM_RULES]: async ({ profileId }, state) => {
    vscode.commands.executeCommand("konveyor.configureCustomRules", profileId, state);
  },

  [OVERRIDE_ANALYZER_BINARIES]() {
    vscode.commands.executeCommand("konveyor.overrideAnalyzerBinaries");
  },
  [OVERRIDE_RPC_SERVER_BINARIES]() {
    vscode.commands.executeCommand("konveyor.overrideKaiRpcServerBinaries");
  },
  [OPEN_GENAI_SETTINGS]() {
    vscode.commands.executeCommand("konveyor.modelProviderSettingsOpen");
  },
  [GET_SOLUTION](scope: Scope) {
    vscode.commands.executeCommand("konveyor.getSolution", scope.incidents, scope.effort);
    vscode.commands.executeCommand("konveyor.diffView.focus");
    vscode.commands.executeCommand("konveyor.showResolutionPanel");
  },
  async [GET_SOLUTION_WITH_KONVEYOR_CONTEXT]({ incident }: ScopeWithKonveyorContext) {
    vscode.commands.executeCommand("konveyor.askContinue", incident);
  },
  [VIEW_FIX](change: LocalChange) {
    vscode.commands.executeCommand(
      "konveyor.diffView.viewFix",
      vscode.Uri.from(change.originalUri),
      true,
    );
  },
  [APPLY_FILE](change: LocalChange) {
    vscode.commands.executeCommand("konveyor.applyFile", vscode.Uri.from(change.originalUri), true);
  },
  [DISCARD_FILE](change: LocalChange) {
    vscode.commands.executeCommand(
      "konveyor.discardFile",
      vscode.Uri.from(change.originalUri),
      true,
    );
  },
  [RUN_ANALYSIS]() {
    vscode.commands.executeCommand("konveyor.runAnalysis");
  },
  async [OPEN_FILE]({ file, line }) {
    const fileUri = vscode.Uri.parse(file);
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(doc, { preview: true });
      const position = new vscode.Position(line - 1, 0);
      const range = new vscode.Range(position, position);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open file: ${error}`);
    }
  },
  [START_SERVER]() {
    vscode.commands.executeCommand("konveyor.startServer");
  },
  [STOP_SERVER]() {
    vscode.commands.executeCommand("konveyor.stopServer");
  },
};

export const messageHandler = async (
  message: WebviewAction<WebviewActionType, unknown>,
  state: ExtensionState,
) => {
  const handler = actions?.[message?.type];
  if (handler) {
    await handler(message.payload, state);
  } else {
    defaultHandler(message);
  }
};

const defaultHandler = (message: WebviewAction<WebviewActionType, unknown>) => {
  console.error("Unknown message from webview:", message);
};

function updateAnalysisConfigFromActiveProfile(draft: ExtensionData) {
  const activeProfile = draft.profiles.find((p) => p.id === draft.activeProfileId);

  if (!activeProfile) {
    draft.analysisConfig = {
      labelSelectorValid: false,
      genAIConfigured: false,
      genAIKeyMissing: false,
      genAIUsingDefault: false,
      customRulesConfigured: false,
    };
    return;
  }

  draft.analysisConfig.labelSelectorValid = !!activeProfile.labelSelector?.trim();
  draft.analysisConfig.customRulesConfigured =
    activeProfile.useDefaultRules || (activeProfile.customRules?.length ?? 0) > 0;
}
