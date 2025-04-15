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
} from "@editor-extensions/shared";

import {
  updateConfigProfiles,
  getConfigProfiles,
  getConfigActiveProfileId,
  updateConfigActiveProfileId,
} from "./utilities/configuration";

export function setupWebviewMessageListener(webview: vscode.Webview, state: ExtensionState) {
  webview.onDidReceiveMessage(async (message) => {
    await messageHandler(message, state);
  });
}

const actions: {
  [name: string]: (payload: any, state: ExtensionState) => void | Promise<void>;
} = {
  [ADD_PROFILE]: async (profile: AnalysisProfile) => {
    const profiles = getConfigProfiles();
    if (profiles.find((p) => p.name === profile.name)) {
      vscode.window.showErrorMessage(`Profile "${profile.name}" already exists.`);
      return;
    }
    await updateConfigProfiles([...profiles, profile]);
    await updateConfigActiveProfileId(profile.id);
  },

  [DELETE_PROFILE]: async (profileId: string) => {
    const profiles = getConfigProfiles().filter((p) => p.id !== profileId);
    await updateConfigProfiles(profiles);

    const activeId = getConfigActiveProfileId();
    if (activeId === profileId) {
      const newActive = profiles[0]?.id;
      if (newActive) {
        await updateConfigActiveProfileId(newActive);
      } else {
        await updateConfigActiveProfileId("");
      }
    }
  },

  [UPDATE_PROFILE]: async ({ originalId, updatedProfile }) => {
    const cleanProfile: AnalysisProfile = {
      id: updatedProfile.id,
      name: updatedProfile.name,
      mode: updatedProfile.mode ?? "source-only",
      customRules: Array.isArray(updatedProfile.customRules) ? [...updatedProfile.customRules] : [],
      useDefaultRules: !!updatedProfile.useDefaultRules,
      labelSelector: updatedProfile.labelSelector ?? "",
    };
    const existingProfiles = getConfigProfiles();
    const isActive = getConfigActiveProfileId() === originalId;
    const profiles: AnalysisProfile[] = existingProfiles.map((p) =>
      p.id === originalId
        ? cleanProfile
        : {
            ...p,
            customRules: Array.isArray(p.customRules) ? [...p.customRules] : [],
          },
    );

    await updateConfigProfiles(profiles);

    if (isActive) {
      await updateConfigActiveProfileId(cleanProfile.id);
    }
  },

  [SET_ACTIVE_PROFILE]: async (profileId: string) => {
    console.log("Setting active profile to:", profileId);
    await updateConfigActiveProfileId(profileId);
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
  [CONFIGURE_CUSTOM_RULES]() {
    vscode.commands.executeCommand("konveyor.configureCustomRules");
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
