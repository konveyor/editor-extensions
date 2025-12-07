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
  OPEN_HUB_SETTINGS,
  UPDATE_HUB_CONFIG,
  HubConfig,
} from "@editor-extensions/shared";

import {
  getAllProfiles,
  getUserProfiles,
  saveUserProfiles,
  setActiveProfileId,
} from "./utilities/profiles/profileService";
import { handleQuickResponse } from "./utilities/ModifiedFiles/handleQuickResponse";
import { handleFileResponse } from "./utilities/ModifiedFiles/handleFileResponse";
import winston from "winston";
import { toggleAgentMode, updateConfigErrors } from "./utilities/configuration";
import { saveHubConfig } from "./utilities/hubConfigStorage";

export function setupWebviewMessageListener(
  webview: vscode.Webview,
  state: ExtensionState,
): vscode.Disposable {
  return webview.onDidReceiveMessage(async (message) => {
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
    const allProfiles = await getAllProfiles(state.extensionContext);

    if (allProfiles.some((p) => p.name === profile.name)) {
      vscode.window.showErrorMessage(`A profile named "${profile.name}" already exists.`);
      return;
    }

    // Only allow adding profiles if we're not in in-tree mode
    const isInTreeMode = allProfiles.length > 0 && allProfiles[0]?.source === "local";
    if (isInTreeMode) {
      vscode.window.showWarningMessage(
        "Cannot add profiles while using in-tree configuration. Profiles are managed in .konveyor/profiles/.",
      );
      return;
    }

    const userProfiles = getUserProfiles(state.extensionContext);
    const updated = [...userProfiles, profile];
    saveUserProfiles(state.extensionContext, updated);

    const updatedAllProfiles = await getAllProfiles(state.extensionContext);
    setActiveProfileId(profile.id, state);

    // Save active profile ID to workspace state (don't use setActiveProfileId - it calls mutateProfiles)
    await state.extensionContext.workspaceState.update("activeProfileId", profile.id);

    // Use mutateProfiles to broadcast profile updates to webview
    state.mutateProfiles((draft) => {
      draft.profiles = updatedAllProfiles;
      draft.activeProfileId = profile.id;
    });

    // Update config errors
    state.mutateConfigErrors((draft) => {
      updateConfigErrorsFromActiveProfile(draft);
    });
  },

  [DELETE_PROFILE]: async (profileId: string, state) => {
    const allProfiles = await getAllProfiles(state.extensionContext);

    // Prevent deletion if in in-tree mode
    const isInTreeMode = allProfiles.length > 0 && allProfiles[0]?.source === "local";
    if (isInTreeMode) {
      vscode.window.showWarningMessage(
        "Cannot delete profiles while using in-tree configuration. Profiles are managed in .konveyor/profiles/.",
      );
      return;
    }

    const userProfiles = getUserProfiles(state.extensionContext);
    const filtered = userProfiles.filter((p) => p.id !== profileId);

    saveUserProfiles(state.extensionContext, filtered);

    const fullProfiles = await getAllProfiles(state.extensionContext);
    const currentActiveProfileId = state.data.activeProfileId;

    // Update active profile if the deleted profile was active
    if (currentActiveProfileId === profileId) {
      const newActiveProfileId = fullProfiles[0]?.id ?? "";
      state.extensionContext.workspaceState.update("activeProfileId", newActiveProfileId);

      // Broadcast profile update with new active profile
      state.mutateProfiles((draft) => {
        draft.profiles = fullProfiles;
        draft.activeProfileId = newActiveProfileId;
      });
    } else {
      // Just update profiles list
      state.mutateProfiles((draft) => {
        draft.profiles = fullProfiles;
      });
    }

    // Update config errors
    state.mutateConfigErrors((draft) => {
      updateConfigErrorsFromActiveProfile(draft);
    });
  },

  [UPDATE_PROFILE]: async ({ originalId, updatedProfile }, state) => {
    const allProfiles = await getAllProfiles(state.extensionContext);
    const profileToUpdate = allProfiles.find((p) => p.id === originalId);

    // Prevent editing if in in-tree mode or if profile is read-only
    if (profileToUpdate?.source === "local") {
      vscode.window.showWarningMessage(
        "In-tree profiles cannot be edited from the UI. Edit the YAML file in .konveyor/profiles/ directly.",
      );
      return;
    }

    if (profileToUpdate?.readOnly) {
      vscode.window.showWarningMessage(
        "Built-in profiles cannot be edited. Copy it to a new profile first.",
      );
      return;
    }

    const updatedList = allProfiles.map((p) =>
      p.id === originalId ? { ...p, ...updatedProfile } : p,
    );

    const userProfiles = updatedList.filter((p) => !p.readOnly && p.source !== "local");
    saveUserProfiles(state.extensionContext, userProfiles);

    const fullProfiles = await getAllProfiles(state.extensionContext);

    // Check if we're updating the active profile
    const currentActiveProfileId = state.data.activeProfileId;
    const isActiveProfile = currentActiveProfileId === originalId;

    // Update profiles and active profile ID if necessary
    state.mutateProfiles((draft) => {
      draft.profiles = fullProfiles;
      if (currentActiveProfileId === originalId) {
        draft.activeProfileId = updatedProfile.id;
      }
    });

    // Update config errors
    state.mutateConfigErrors((draft) => {
      updateConfigErrorsFromActiveProfile(draft);
    });

    // Stop the analyzer server if active profile was updated
    // This ensures custom rules changes take effect on next analysis
    if (isActiveProfile && state.analyzerClient.isServerRunning()) {
      state.logger.info("Active profile updated, stopping analyzer server to apply changes");
      await state.analyzerClient.stop();
      vscode.window.showInformationMessage(
        "Profile updated. Analyzer server stopped. Please restart the server to apply custom rule changes.",
      );
    }
  },

  [SET_ACTIVE_PROFILE]: async (profileId: string, state) => {
    const allProfiles = await getAllProfiles(state.extensionContext);
    const valid = allProfiles.find((p) => p.id === profileId);
    if (!valid) {
      vscode.window.showErrorMessage(`Cannot set active profile. Profile not found.`);
      return;
    }

    // Check if profile is actually changing
    const currentActiveProfileId = state.data.activeProfileId;
    const isProfileChanging = currentActiveProfileId !== profileId;

    // Save active profile ID to workspace state (don't use setActiveProfileId - it calls mutateProfiles)
    await state.extensionContext.workspaceState.update("activeProfileId", profileId);

    // Broadcast active profile change to webview
    state.mutateProfiles((draft) => {
      draft.activeProfileId = profileId;
    });

    // Update config errors
    state.mutateConfigErrors((draft) => {
      updateConfigErrorsFromActiveProfile(draft);
    });

    // Stop the analyzer server when switching profiles
    // This ensures the new profile's custom rules are applied on next analysis
    if (isProfileChanging && state.analyzerClient.isServerRunning()) {
      state.logger.info(`Active profile changed to ${profileId}, stopping analyzer server`);
      await state.analyzerClient.stop();
      vscode.window.showInformationMessage(
        "Profile changed. Start the server to apply the new profile's custom rules.",
      );
    }
  },

  [OPEN_PROFILE_MANAGER]() {
    executeExtensionCommand("openProfilesPanel");
  },
  [OPEN_HUB_SETTINGS]() {
    executeExtensionCommand("openHubSettingsPanel");
  },
  [UPDATE_HUB_CONFIG]: async (config: HubConfig, state) => {
    // Save to VS Code Secret Storage
    await saveHubConfig(state.extensionContext, config);

    // Update state
    state.mutateSettings((draft) => {
      draft.hubConfig = config;
      draft.solutionServerEnabled = config.enabled && config.features.solutionServer.enabled;
    });

    // Update hub connection manager - it handles all connection logic internally
    await state.hubConnectionManager.updateConfig(config);

    // Update connection state based on actual connection status
    state.mutateServerState((draft) => {
      draft.solutionServerConnected = state.hubConnectionManager.isSolutionServerConnected();
    });
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

      // Clear the processing state for this file on error
      // This prevents the UI from getting stuck in "Processing changes..."
      state.mutateSolutionWorkflow((draft) => {
        // Clear from pendingBatchReview if there's an error
        if (draft.pendingBatchReview) {
          const fileIndex = draft.pendingBatchReview.findIndex(
            (file) => file.messageToken === messageToken,
          );
          if (fileIndex !== -1) {
            // Mark as error rather than removing, so user can retry
            draft.pendingBatchReview[fileIndex].hasError = true;
            logger.info(`Marked file as error in pendingBatchReview: ${path}`);
          }
        }
      });

      vscode.window.showErrorMessage(`Failed to show diff with decorations: ${error}`);
    }
  },
  QUICK_RESPONSE: async ({ responseId, messageToken }, state) => {
    handleQuickResponse(messageToken, responseId, state);
  },
  FILE_RESPONSE: async ({ responseId, messageToken, path, content }, state, logger) => {
    await handleFileResponse(messageToken, responseId, path, content, state);

    // Remove from pendingBatchReview after processing individual file
    state.mutateSolutionWorkflow((draft) => {
      if (draft.pendingBatchReview) {
        draft.pendingBatchReview = draft.pendingBatchReview.filter(
          (file) => file.messageToken !== messageToken,
        );
        logger.info(`Removed file from pendingBatchReview: ${path}`, {
          remaining: draft.pendingBatchReview.length,
        });
      }
    });

    // Check if batch review is complete
    checkBatchReviewComplete(state, logger);
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

      await handleFileResponse(messageToken, responseId, path, finalContent, state, true); // Skip analysis - it runs on save

      // Remove from pendingBatchReview after processing
      state.mutateSolutionWorkflow((draft) => {
        if (draft.pendingBatchReview) {
          draft.pendingBatchReview = draft.pendingBatchReview.filter(
            (file) => file.messageToken !== messageToken,
          );
        }
      });

      logger.info(`File state continued with response: ${responseId}`, {
        path,
        messageToken,
      });

      // Check if workflow cleanup should happen
      checkBatchReviewComplete(state, logger);
    } catch (error) {
      logger.error("Error handling CONTINUE_WITH_FILE_STATE:", error);
      await handleFileResponse(messageToken, "reject", path, content, state, true); // Skip analysis - it runs on save

      // Remove from pendingBatchReview after error handling
      state.mutateSolutionWorkflow((draft) => {
        if (draft.pendingBatchReview) {
          draft.pendingBatchReview = draft.pendingBatchReview.filter(
            (file) => file.messageToken !== messageToken,
          );
        }
      });

      // Check if workflow cleanup should happen
      checkBatchReviewComplete(state, logger);
    }
  },

  BATCH_APPLY_ALL: async ({ files }, state, logger) => {
    const failures: Array<{ path: string; error: string }> = [];

    try {
      logger.info(`BATCH_APPLY_ALL: Applying ${files.length} files`);
      console.log(`[BATCH_APPLY_ALL] Processing ${files.length} files`);

      // Set processing flag at the start
      state.mutateSolutionWorkflow((draft) => {
        draft.isProcessingQueuedMessages = true;
      });

      // Process files one by one with individual error handling
      for (const file of files) {
        try {
          logger.info(`BATCH_APPLY_ALL: Applying file ${file.path}`);
          await handleFileResponse(file.messageToken, "apply", file.path, file.content, state);

          // Remove this file from pendingBatchReview only on success
          state.mutateSolutionWorkflow((draft) => {
            if (draft.pendingBatchReview) {
              draft.pendingBatchReview = draft.pendingBatchReview.filter(
                (f) => f.messageToken !== file.messageToken,
              );
              logger.info(
                `BATCH_APPLY_ALL: Removed ${file.path}, ${draft.pendingBatchReview.length} files remaining`,
              );
            }
          });
        } catch (fileError) {
          const errorMessage = fileError instanceof Error ? fileError.message : String(fileError);
          logger.error(`BATCH_APPLY_ALL: Failed to apply file ${file.path}:`, fileError);
          failures.push({ path: file.path, error: errorMessage });

          // Mark the file as having an error in pendingBatchReview
          state.mutateSolutionWorkflow((draft) => {
            if (draft.pendingBatchReview) {
              const fileIndex = draft.pendingBatchReview.findIndex(
                (f) => f.messageToken === file.messageToken,
              );
              if (fileIndex !== -1) {
                draft.pendingBatchReview[fileIndex].hasError = true;
              }
            }
          });
        }
      }

      // Report results
      const successCount = files.length - failures.length;
      logger.info(
        `BATCH_APPLY_ALL: Completed. Success: ${successCount}, Failed: ${failures.length}`,
      );

      // Notify user if there were failures
      if (failures.length > 0) {
        const failureDetails = failures.map((f) => `• ${f.path}: ${f.error}`).join("\n");
        logger.error(`BATCH_APPLY_ALL: Failures:\n${failureDetails}`);

        if (failures.length === 1) {
          vscode.window.showErrorMessage(
            `Failed to apply 1 file: ${failures[0].path}. See output for details.`,
          );
        } else {
          vscode.window.showErrorMessage(
            `Failed to apply ${failures.length} out of ${files.length} files. See output for details.`,
          );
        }
      } else {
        logger.info(`BATCH_APPLY_ALL: Successfully applied all ${files.length} files`);
        console.log(`[BATCH_APPLY_ALL] Successfully completed`);
      }

      // Check if workflow cleanup should happen
      checkBatchReviewComplete(state, logger);
    } catch (unexpectedError) {
      logger.error("Unexpected error in BATCH_APPLY_ALL:", unexpectedError);
      console.error("[BATCH_APPLY_ALL] Unexpected error:", unexpectedError);

      vscode.window.showErrorMessage(
        "An unexpected error occurred while applying files. Check the output for details.",
      );
    } finally {
      // Always reset processing flag
      state.mutateSolutionWorkflow((draft) => {
        draft.isProcessingQueuedMessages = false;
      });
    }
  },

  BATCH_REJECT_ALL: async ({ files }, state, logger) => {
    const failures: Array<{ path: string; error: string }> = [];

    try {
      logger.info(`BATCH_REJECT_ALL: Rejecting ${files.length} files`);
      console.log(`[BATCH_REJECT_ALL] Processing ${files.length} files`);

      // Set processing flag at the start
      state.mutateSolutionWorkflow((draft) => {
        draft.isProcessingQueuedMessages = true;
      });

      // Process files one by one with individual error handling
      for (const file of files) {
        try {
          logger.info(`BATCH_REJECT_ALL: Rejecting file ${file.path}`);
          await handleFileResponse(file.messageToken, "reject", file.path, undefined, state);

          // Remove this file from pendingBatchReview only on success
          state.mutateSolutionWorkflow((draft) => {
            if (draft.pendingBatchReview) {
              draft.pendingBatchReview = draft.pendingBatchReview.filter(
                (f) => f.messageToken !== file.messageToken,
              );
              logger.info(
                `BATCH_REJECT_ALL: Removed ${file.path}, ${draft.pendingBatchReview.length} files remaining`,
              );
            }
          });
        } catch (fileError) {
          const errorMessage = fileError instanceof Error ? fileError.message : String(fileError);
          logger.error(`BATCH_REJECT_ALL: Failed to reject file ${file.path}:`, fileError);
          failures.push({ path: file.path, error: errorMessage });

          // Mark the file as having an error in pendingBatchReview
          state.mutateSolutionWorkflow((draft) => {
            if (draft.pendingBatchReview) {
              const fileIndex = draft.pendingBatchReview.findIndex(
                (f) => f.messageToken === file.messageToken,
              );
              if (fileIndex !== -1) {
                draft.pendingBatchReview[fileIndex].hasError = true;
              }
            }
          });
        }
      }

      // Report results
      const successCount = files.length - failures.length;
      logger.info(
        `BATCH_REJECT_ALL: Completed. Success: ${successCount}, Failed: ${failures.length}`,
      );

      // Notify user if there were failures
      if (failures.length > 0) {
        const failureDetails = failures.map((f) => `• ${f.path}: ${f.error}`).join("\n");
        logger.error(`BATCH_REJECT_ALL: Failures:\n${failureDetails}`);

        if (failures.length === 1) {
          vscode.window.showErrorMessage(
            `Failed to reject 1 file: ${failures[0].path}. See output for details.`,
          );
        } else {
          vscode.window.showErrorMessage(
            `Failed to reject ${failures.length} out of ${files.length} files. See output for details.`,
          );
        }
      } else {
        logger.info(`BATCH_REJECT_ALL: Successfully rejected all ${files.length} files`);
        console.log(`[BATCH_REJECT_ALL] Successfully completed`);
      }

      // Check if workflow cleanup should happen
      checkBatchReviewComplete(state, logger);
    } catch (unexpectedError) {
      logger.error("Unexpected error in BATCH_REJECT_ALL:", unexpectedError);
      console.error("[BATCH_REJECT_ALL] Unexpected error:", unexpectedError);

      vscode.window.showErrorMessage(
        "An unexpected error occurred while rejecting files. Check the output for details.",
      );
    } finally {
      // Always reset processing flag
      state.mutateSolutionWorkflow((draft) => {
        draft.isProcessingQueuedMessages = false;
      });
    }
  },
};

// Helper function to check if batch review is complete
const checkBatchReviewComplete = (state: ExtensionState, logger: winston.Logger) => {
  const hasPendingBatchReview =
    state.data.pendingBatchReview && state.data.pendingBatchReview.length > 0;

  if (!hasPendingBatchReview) {
    logger.info("Batch review complete");

    // Clear any remaining state
    state.mutateSolutionWorkflow((draft) => {
      draft.pendingBatchReview = [];
    });
  }
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
