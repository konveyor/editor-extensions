import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import {
  ADD_PROFILE,
  AnalysisProfile,
  ChatMessageType,
  CONFIGURE_CUSTOM_RULES,
  CONFIGURE_LABEL_SELECTOR,
  CONFIGURE_SOURCES_TARGETS,
  DELETE_PROFILE,
  GET_SOLUTION,
  GET_SOLUTION_WITH_KONVEYOR_CONTEXT,
  GET_SUCCESS_RATE,
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
  TOGGLE_AGENT_MODE,
  UPDATE_PROFILE,
  WEBVIEW_READY,
  WebviewAction,
  WebviewActionType,
  ScopeWithKonveyorContext,
  ExtensionData,
  createConfigError,
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
import { toggleAgentMode } from "./utilities/configuration";

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
    vscode.commands.executeCommand("konveyor.openProfilesPanel");
  },
  [WEBVIEW_READY](_payload, _state, logger) {
    logger.info("Webview is ready");
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
    vscode.commands.executeCommand("konveyor.getSolution", scope.incidents);
    vscode.commands.executeCommand("konveyor.showResolutionPanel");
  },
  async [GET_SOLUTION_WITH_KONVEYOR_CONTEXT]({ incident }: ScopeWithKonveyorContext) {
    vscode.commands.executeCommand("konveyor.askContinue", incident);
  },
  // APPLY_FILE and DISCARD_FILE removed - using unified decorator flow
  // New actions with unique names to avoid overwriting existing diff view commands
  REJECT_FILE: async ({ path }, _state, logger) => {
    try {
      // For rejecting changes, we don't need to do anything since we're not
      // directly modifying the real file until the user applies changes
      vscode.window.showInformationMessage(
        `Changes rejected for ${vscode.workspace.asRelativePath(vscode.Uri.file(path))}`,
      );
    } catch (error) {
      logger.error("Error handling NEW_REJECT_FILE:", error);
      vscode.window.showErrorMessage(`Failed to reject changes: ${error}`);
    }
  },
  SHOW_DIFF_WITH_DECORATORS: async ({ path, diff, content, messageToken }, state, logger) => {
    try {
      logger.info("SHOW_DIFF_WITH_DECORATORS called", { path, messageToken });

      // Execute the command to show diff with decorations using streaming approach
      await vscode.commands.executeCommand(
        "konveyor.showDiffWithDecorations",
        path,
        diff,
        content,
        messageToken,
      );
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

  CHECK_FILE_STATE: async ({ path, messageToken }, state, logger) => {
    try {
      const uri = vscode.Uri.file(path);

      // Get the current file content
      const currentContent = await vscode.workspace.fs.readFile(uri);
      const currentText = currentContent.toString();

      // Find the chat message with the original and suggested content
      const fileMessage = state.data.chatMessages.find(
        (msg) =>
          msg.kind === ChatMessageType.ModifiedFile &&
          msg.messageToken === messageToken &&
          (msg.value as any).path === path,
      );

      if (!fileMessage) {
        vscode.window.showErrorMessage(`No changes found for file: ${path}`);
        return;
      }

      const fileValue = fileMessage.value as any;

      // Get the original content from modifiedFiles state or reconstruct it
      let originalContent = "";
      let suggestedContent = "";
      const modifiedFileState = state.modifiedFiles.get(path);

      logger.debug(`ModifiedFileState exists: ${!!modifiedFileState}`);
      logger.debug(
        `ModifiedFileState has originalContent: ${!!modifiedFileState?.originalContent}`,
      );

      if (modifiedFileState?.originalContent) {
        originalContent = modifiedFileState.originalContent;
        suggestedContent = fileValue.content;
        logger.debug(`Using originalContent from modifiedFiles state`);
      } else {
        // For VIEW_FILE flow, we need to reconstruct the baseline content
        // The diff in the chat message was applied to some baseline to get the suggested content
        // We need to reverse-engineer what that baseline was

        logger.debug(`No originalContent in modifiedFiles, attempting to reconstruct baseline`);

        try {
          // Wrap diff reconstruction in a timeout to prevent hanging
          const DIFF_TIMEOUT_MS = 3000; // 3 seconds timeout

          const diffReconstructionPromise = (async () => {
            // Try to reverse-apply the diff to get the baseline content
            const { applyPatch, reversePatch } = await import("diff");

            // Get the diff from the chat message
            const diffContent = fileValue.diff;
            if (!diffContent) {
              throw new Error("No diff content available");
            }

            // The suggested content is what we get when we apply the diff to the baseline
            suggestedContent = fileValue.content;

            // Try to reverse the diff to get the original content
            const reversedDiff = reversePatch(diffContent);
            const reconstructedOriginal = applyPatch(suggestedContent, reversedDiff);

            if (reconstructedOriginal !== false) {
              originalContent = reconstructedOriginal;
              logger.debug(`Successfully reconstructed original content from diff`);
            } else {
              throw new Error("Failed to reverse-apply diff");
            }
          })();

          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Diff reconstruction timed out after ${DIFF_TIMEOUT_MS}ms`));
            }, DIFF_TIMEOUT_MS);
          });

          // Race between diff reconstruction and timeout
          await Promise.race([diffReconstructionPromise, timeoutPromise]);
        } catch (error) {
          logger.debug(`Failed to reconstruct original content: ${error}`);

          // Final fallback: Use simplified logic based on file save state
          logger.debug(`Using simplified logic based on file save state`);

          const doc = await vscode.workspace.openTextDocument(uri);
          const responseId = !doc.isDirty ? "apply" : "reject";
          const reason = !doc.isDirty ? "file was saved after viewing" : "file has unsaved changes";

          logger.debug(`Simplified decision: ${responseId.toUpperCase()} - ${reason}`);

          await handleFileResponse(messageToken, responseId, path, fileValue.content, state);

          // File tracking removed - using full diff view approach

          return; // Exit early with simplified logic
        }
      }

      // Normalize content for comparison (handle line endings and whitespace)
      const normalize = (text: string) => {
        // Use the same normalization approach as myers.ts
        return text.replace(/\r\n/g, "\n").replace(/\n$/, ""); // Remove trailing newline for comparison
      };
      const normalizedCurrent = normalize(currentText);
      const normalizedOriginal = normalize(originalContent);
      const normalizedSuggested = normalize(suggestedContent);

      // Get document to check if it's been saved
      const doc = await vscode.workspace.openTextDocument(uri);

      // Add detailed logging for debugging
      logger.debug(`=== FILE STATE CHECK DEBUG ===`);
      logger.debug(`Path: ${path}`);
      logger.debug(`File isDirty: ${doc.isDirty}`);
      logger.debug(`Current content length: ${normalizedCurrent.length}`);
      logger.debug(`Suggested content length: ${normalizedSuggested.length}`);
      logger.debug(`Current === Suggested: ${normalizedCurrent === normalizedSuggested}`);
      logger.debug(`Current === Original: ${normalizedCurrent === normalizedOriginal}`);

      // Determine if changes were applied
      let changesApplied = false;
      let reason = "";

      if (normalizedCurrent === normalizedSuggested) {
        // Exact match with suggested content - definitely applied
        changesApplied = true;
        reason = "exact match with suggested content";
      } else if (normalizedCurrent === normalizedOriginal) {
        // Exact match with original content - definitely rejected
        changesApplied = false;
        reason = "exact match with original content";
      } else {
        // Content has been modified from both original and suggested
        // In this case, if the user saved the file, we assume they want to apply their changes
        changesApplied = !doc.isDirty;
        reason = doc.isDirty ? "file has unsaved changes" : "file was saved with modifications";
      }

      logger.debug(`Decision: ${changesApplied ? "APPLY" : "REJECT"} - ${reason}`);
      logger.debug(`=== END DEBUG ===`);

      // Send the appropriate response
      const responseId = changesApplied ? "apply" : "reject";
      await handleFileResponse(messageToken, responseId, path, fileValue.content, state);

      // File tracking removed - using full diff view approach
    } catch (error) {
      logger.error("Error handling CHECK_FILE_STATE:", error);
      vscode.window.showErrorMessage(`Failed to check file state: ${error}`);
    }
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
    vscode.commands.executeCommand("konveyor.startServer");
  },
  [STOP_SERVER]() {
    vscode.commands.executeCommand("konveyor.stopServer");
  },
  [GET_SUCCESS_RATE]() {
    vscode.commands.executeCommand("konveyor.getSuccessRate");
  },
  [TOGGLE_AGENT_MODE]() {
    toggleAgentMode();
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
  const activeProfile = draft.profiles.find((p) => p.id === draft.activeProfileId);

  // Clear profile-related errors
  draft.configErrors = draft.configErrors.filter(
    (error) =>
      error.type !== "no-active-profile" &&
      error.type !== "invalid-label-selector" &&
      error.type !== "no-custom-rules",
  );

  if (!activeProfile) {
    draft.configErrors.push(createConfigError.noActiveProfile());
    return;
  }

  // Check label selector
  if (!activeProfile.labelSelector?.trim()) {
    draft.configErrors.push(createConfigError.invalidLabelSelector());
  }

  // Check custom rules when default rules are disabled
  if (
    !activeProfile.useDefaultRules &&
    (!activeProfile.customRules || activeProfile.customRules.length === 0)
  ) {
    draft.configErrors.push(createConfigError.noCustomRules());
  }
}
