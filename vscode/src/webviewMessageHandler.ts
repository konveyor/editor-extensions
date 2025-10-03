import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import { executeExtensionCommand } from "./commands";
import {
  ADD_PROFILE,
  AnalysisProfile,
  CONFIGURE_CUSTOM_RULES,
  DELETE_PROFILE,
  GET_SOLUTION,
  GET_SOLUTION_WITH_KONVEYOR_CONTEXT,
  GET_SUCCESS_RATE,
  OPEN_FILE,
  OPEN_GENAI_SETTINGS,
  OVERRIDE_ANALYZER_BINARIES,
  OPEN_PROFILE_MANAGER,
  RUN_ANALYSIS,
  Scope,
  SET_ACTIVE_PROFILE,
  START_SERVER,
  STOP_SERVER,
  RESTART_SOLUTION_SERVER,
  ENABLE_GENAI,
  TOGGLE_AGENT_MODE,
  UPDATE_PROFILE,
  WEBVIEW_READY,
  WebviewAction,
  WebviewActionType,
  ScopeWithKonveyorContext,
  ExtensionData,
  OPEN_RESOLUTION_PANEL,
} from "@editor-extensions/shared";

import { getBundledProfiles } from "./utilities/profiles/bundledProfiles";
import {
  getUserProfiles,
  saveUserProfiles,
  setActiveProfileId,
} from "./utilities/profiles/profileService";
import { handleQuickResponse } from "./utilities/ModifiedFiles/handleQuickResponse";
import { handleFileResponse } from "./utilities/ModifiedFiles/handleFileResponse";
import winston from "winston";
import { toggleAgentMode, updateConfigErrors } from "./utilities/configuration";

export function setupWebviewMessageListener(webview: vscode.Webview, state: ExtensionState) {
  webview.onDidReceiveMessage(async (message) => {
    const logger = state.logger.child({
      component: "webviewMessageHandler",
    });
    await messageHandler(message, state, logger);
  });
}

const actions: {
  [name: string]: (
    payload: any,
    state: ExtensionState,
    logger: winston.Logger,
  ) => void | Promise<void>;
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
      updateConfigErrorsFromActiveProfile(draft);
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
      updateConfigErrorsFromActiveProfile(draft);
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
      updateConfigErrorsFromActiveProfile(draft);
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
      updateConfigErrorsFromActiveProfile(draft);
    });
  },

  [OPEN_PROFILE_MANAGER]() {
    executeExtensionCommand("openProfilesPanel");
  },
  [WEBVIEW_READY](_payload, _state, logger) {
    logger.info("Webview is ready");
  },
  [CONFIGURE_CUSTOM_RULES]: async ({ profileId }, _state) => {
    executeExtensionCommand("configureCustomRules", profileId);
  },

  [OVERRIDE_ANALYZER_BINARIES]() {
    executeExtensionCommand("overrideAnalyzerBinaries");
  },
  [OPEN_GENAI_SETTINGS]() {
    executeExtensionCommand("modelProviderSettingsOpen");
  },
  [GET_SOLUTION](scope: Scope) {
    executeExtensionCommand("getSolution", scope.incidents);
    executeExtensionCommand("showResolutionPanel");
  },
  async [GET_SOLUTION_WITH_KONVEYOR_CONTEXT]({ incident }: ScopeWithKonveyorContext) {
    executeExtensionCommand("askContinue", incident);
  },
  SHOW_DIFF_WITH_DECORATORS: async ({ path, diff, content, messageToken }, state, logger) => {
    try {
      logger.info("SHOW_DIFF_WITH_DECORATORS called", { path, messageToken });

      // Execute the command to show diff with decorations using streaming approach
      await executeExtensionCommand("showDiffWithDecorations", path, diff, content, messageToken);
    } catch (error) {
      logger.error("Error handling SHOW_DIFF_WITH_DECORATORS:", error);
      vscode.window.showErrorMessage(`Failed to show diff with decorations: ${error}`);
    }
  },
  QUICK_RESPONSE: async ({ responseId, messageToken }, state) => {
    handleQuickResponse(messageToken, responseId, state);
  },
  FILE_RESPONSE: async ({ responseId, messageToken, path, content }, state) => {
    handleFileResponse(messageToken, responseId, path, content, state);
  },

  [RUN_ANALYSIS]() {
    executeExtensionCommand("runAnalysis");
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
  OPEN_FILE_IN_EDITOR: async ({ path }, _state, logger) => {
    try {
      const fileUri = vscode.Uri.file(path);
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error) {
      logger.error("Error opening file in editor:", error);
      vscode.window.showErrorMessage(`Failed to open file in editor: ${error}`);
    }
  },
  [START_SERVER]() {
    executeExtensionCommand("startServer");
  },
  [STOP_SERVER]() {
    executeExtensionCommand("stopServer");
  },
  [RESTART_SOLUTION_SERVER]() {
    vscode.commands.executeCommand("konveyor.restartSolutionServer");
  },
  [ENABLE_GENAI]() {
    executeExtensionCommand("enableGenAI");
  },
  [GET_SUCCESS_RATE]() {
    executeExtensionCommand("getSuccessRate");
  },
  [TOGGLE_AGENT_MODE]() {
    toggleAgentMode();
  },
  [OPEN_RESOLUTION_PANEL]() {
    executeExtensionCommand("showResolutionPanel");
  },
  CONTINUE_WITH_FILE_STATE: async ({ path, messageToken, content }, state, logger) => {
    try {
      logger.info("CONTINUE_WITH_FILE_STATE called", { path, messageToken });

      const uri = vscode.Uri.file(path);

      // Get the current file content
      const currentContent = await vscode.workspace.fs.readFile(uri);
      const currentText = currentContent.toString();

      // Get the original content to compare against
      const modifiedFileState = state.modifiedFiles.get(path);
      const originalContent = modifiedFileState?.originalContent || "";

      // Simple logic: if file changed from original = accepted, if unchanged = rejected
      const normalize = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n$/, "");
      const hasChanges = normalize(currentText) !== normalize(originalContent);

      const responseId = hasChanges ? "apply" : "reject";
      const finalContent = hasChanges ? currentText : content;

      logger.debug(
        `Continue decision: ${responseId.toUpperCase()} - ${hasChanges ? "file has changes" : "file unchanged"}`,
      );
      console.log("Continue decision: ", { responseId, hasChanges });

      await handleFileResponse(messageToken, responseId, path, finalContent, state);
      logger.info(`File state continued with response: ${responseId}`, {
        path,
        messageToken,
      });
    } catch (error) {
      logger.error("Error handling CONTINUE_WITH_FILE_STATE:", error);
      await handleFileResponse(messageToken, "reject", path, content, state);
    }
  },
};

export const messageHandler = async (
  message: WebviewAction<WebviewActionType, unknown>,
  state: ExtensionState,
  logger: winston.Logger,
) => {
  logger.debug("messageHandler: " + JSON.stringify(message));
  const handler = actions?.[message?.type];
  if (handler) {
    await handler(message.payload, state, logger);
  } else {
    defaultHandler(message, logger);
  }
};

const defaultHandler = (
  message: WebviewAction<WebviewActionType, unknown>,
  logger: winston.Logger,
) => {
  logger.error("Unknown message from webview:", JSON.stringify(message));
};

function updateConfigErrorsFromActiveProfile(draft: ExtensionData) {
  // Clear profile-related errors
  draft.configErrors = draft.configErrors.filter(
    (error) =>
      error.type !== "no-active-profile" &&
      error.type !== "invalid-label-selector" &&
      error.type !== "no-custom-rules",
  );

  // Use the centralized updateConfigErrors function for consistency
  // Note: settingsPath is not used in the current implementation, so we pass empty string
  updateConfigErrors(draft, "");
}
