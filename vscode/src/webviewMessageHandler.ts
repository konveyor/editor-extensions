import * as vscode from "vscode";
import { Webview, Uri, workspace, window, commands } from "vscode";
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
  ChatMessageType,
  KaiWorkflowMessageType,
  KaiUserIteraction,
  type KaiWorkflowMessage,
} from "@editor-extensions/shared";

import { getBundledProfiles } from "./utilities/profiles/bundledProfiles";
import {
  getUserProfiles,
  saveUserProfiles,
  setActiveProfileId,
} from "./utilities/profiles/profileService";

export function setupWebviewMessageListener(webview: Webview, state: ExtensionState) {
  webview.onDidReceiveMessage(
    async (message: WebviewAction<WebviewActionType, unknown>) => {
      await messageHandler(message, state);
    },
    undefined,
    state.extensionContext.subscriptions,
  );
}

const actions: {
  [name: string]: (payload: any, state: ExtensionState) => void | Promise<void>;
} = {
  VIEW_FILE: async ({ path }, state) => {
    try {
      const uri = Uri.file(path);
      const doc = await workspace.openTextDocument(uri);
      await window.showTextDocument(doc, { preview: true });
    } catch (error) {
      console.error("Error handling VIEW_FILE:", error);
      window.showErrorMessage(`Failed to open file: ${error}`);
    }
  },

  APPLY_MODIFIED_FILE: async ({ path }, state) => {
    try {
      const uri = Uri.file(path);
      // Find the corresponding change in agentModifiedFiles
      const change = state.data.localChanges.find(
        (c) => c.originalUri.fsPath === uri.fsPath || c.modifiedUri.fsPath === uri.fsPath,
      );

      if (change) {
        await commands.executeCommand("konveyor.applyFile", uri);
      } else {
        console.error(`No change found for file: ${path}`);
        window.showErrorMessage(`No change found for file: ${path}`);
      }
    } catch (error) {
      console.error("Error handling APPLY_FILE:", error);
      window.showErrorMessage(`Failed to apply changes: ${error}`);
    }
  },

  REJECT_FILE: async ({ path }, state) => {
    try {
      const uri = Uri.file(path);
      // Find the corresponding change in agentModifiedFiles
      const change = state.data.localChanges.find(
        (c) => c.originalUri.fsPath === uri.fsPath || c.modifiedUri.fsPath === uri.fsPath,
      );

      if (change) {
        await commands.executeCommand("konveyor.discardFile", uri);
      } else {
        console.error(`No change found for file: ${path}`);
        window.showErrorMessage(`No change found for file: ${path}`);
      }
    } catch (error) {
      console.error("Error handling REJECT_FILE:", error);
      window.showErrorMessage(`Failed to reject changes: ${error}`);
    }
  },
  GET_FILE_CONTENT: async ({ diff, originalUri, modifiedUri }, state) => {
    try {
      console.log("GET_FILE_CONTENT received with diff length:", diff ? diff.length : 0);

      // Just use the diff directly without trying to read files
      let originalContent = "";
      let modifiedContent = "";

      try {
        // Check if the diff is too large (more than 100KB)
        const isLargeDiff = diff && diff.length > 100000;
        if (isLargeDiff) {
          console.log("Large diff detected, using optimized parsing");
        }

        // Extract content from the diff itself
        const lines = diff.split("\n");
        const contextLines: string[] = [];
        let inHunk = false;

        // Pre-allocate string buffers for better performance
        const originalBuffer = "";
        const modifiedBuffer = "";
        const originalLines: string[] = [];
        const modifiedLines: string[] = [];

        // First pass: collect lines
        for (const line of lines) {
          // Skip diff headers
          if (
            line.startsWith("diff ") ||
            line.startsWith("index ") ||
            line.startsWith("--- ") ||
            line.startsWith("+++ ")
          ) {
            continue;
          }

          // Start of a hunk
          if (line.startsWith("@@")) {
            inHunk = true;
            continue;
          }

          if (inHunk) {
            if (line.startsWith("-")) {
              // Line only in original
              originalLines.push(line.substring(1));
            } else if (line.startsWith("+")) {
              // Line only in modified
              modifiedLines.push(line.substring(1));
            } else if (line.startsWith(" ")) {
              // Line in both
              const content = line.substring(1);
              originalLines.push(content);
              modifiedLines.push(content);
              contextLines.push(content);
            }
          }
        }

        // Second pass: join lines (more efficient than concatenating strings)
        originalContent = originalLines.join("\n");
        modifiedContent = modifiedLines.join("\n");

        console.log(
          "Extracted content from diff - original length:",
          originalContent.length,
          "modified length:",
          modifiedContent.length,
        );

        // If we couldn't extract enough content, try to apply the diff
        if (originalContent.trim().length === 0 || modifiedContent.trim().length === 0) {
          try {
            const { applyPatch } = await import("diff");
            // Use context lines as base if available
            const baseContent = contextLines.join("\n");
            modifiedContent = applyPatch(baseContent, diff) as string;
            originalContent = baseContent;
            console.log("Applied diff to context lines");
          } catch (diffErr) {
            console.error("Error applying diff to context:", diffErr);
          }
        }
      } catch (err) {
        console.error("Error extracting content from diff:", err);
      }

      // If we still don't have content, create some placeholder content
      if (originalContent.trim().length === 0) {
        // Try to get file name for better error message
        let fileName = "file";
        try {
          if (typeof originalUri === "string") {
            const parts = originalUri.split("/");
            fileName = parts[parts.length - 1];
          } else if (originalUri && originalUri.path) {
            const parts = originalUri.path.split("/");
            fileName = parts[parts.length - 1];
          }
        } catch (err) {
          console.error("Error getting file name:", err);
        }

        originalContent = `// Original content for ${fileName} could not be retrieved\n// This may be a new file or the diff doesn't contain enough context`;
      }

      if (modifiedContent.trim().length === 0) {
        // Try to get file name for better error message
        let fileName = "file";
        try {
          if (typeof originalUri === "string") {
            const parts = originalUri.split("/");
            fileName = parts[parts.length - 1];
          } else if (originalUri && originalUri.path) {
            const parts = originalUri.path.split("/");
            fileName = parts[parts.length - 1];
          }
        } catch (err) {
          console.error("Error getting file name:", err);
        }

        modifiedContent = `// Modified content for ${fileName} could not be retrieved\n// This may be a deleted file or the diff doesn't contain enough context`;
      }

      // Send the content back to the webview
      const webviewProvider = state.webviewProviders.get("resolution");
      if (webviewProvider) {
        webviewProvider.sendMessageToWebview({
          type: "FILE_CONTENT_RESPONSE",
          payload: {
            originalContent,
            modifiedContent,
          },
        });
      }
    } catch (error) {
      console.error("Error handling GET_FILE_CONTENT:", error);
    }
  },
  QUICK_RESPONSE: async ({ responseId, messageToken }, state) => {
    // Set loading state
    state.mutateData((draft) => {
      draft.isProcessingQuickResponse = true;
    });

    try {
      const messageIndex = state.data.chatMessages.findIndex(
        (msg) => msg.messageToken === messageToken,
      );

      if (messageIndex === -1) {
        console.error("Message token not found:", messageToken);
        return;
      }

      const msg = state.data.chatMessages[messageIndex];

      // Add user's response to chat
      state.mutateData((draft) => {
        draft.chatMessages.push({
          kind: ChatMessageType.String,
          messageToken: msg.messageToken,
          timestamp: new Date().toISOString(),
          value: {
            message: responseId === "yes" ? "Yes" : responseId === "no" ? "No" : responseId,
          },
        });
      });

      // Create the workflow message with proper typing
      const workflowMessage: KaiWorkflowMessage = {
        id: messageToken,
        type: KaiWorkflowMessageType.UserInteraction,
        data: {
          type: responseId.startsWith("choice-") ? "choice" : "yesNo",
          response: responseId.startsWith("choice-")
            ? {
                choice: parseInt(responseId.split("-")[1]),
              }
            : {
                yesNo: responseId === "yes",
              },
        } as KaiUserIteraction,
      };

      if (!state.workflowManager.isInitialized) {
        console.error("Workflow not initialized");
        return;
      }

      const workflow = state.workflowManager.getWorkflow();
      await workflow.resolveUserInteraction(workflowMessage);
    } finally {
      // Clear loading state
      state.mutateData((draft) => {
        draft.isProcessingQuickResponse = false;
      });
    }
  },

  FILE_RESPONSE: async ({ responseId, messageToken, path }, state) => {
    // Set loading state
    state.mutateData((draft) => {
      draft.isProcessingQuickResponse = true;
    });

    try {
      const messageIndex = state.data.chatMessages.findIndex(
        (msg) => msg.messageToken === messageToken,
      );

      if (messageIndex === -1) {
        console.error("Message token not found:", messageToken);
        return;
      }

      const msg = state.data.chatMessages[messageIndex];

      // Add user's response to chat
      state.mutateData((draft) => {
        draft.chatMessages.push({
          kind: ChatMessageType.String,
          messageToken: msg.messageToken,
          timestamp: new Date().toISOString(),
          value: {
            message: responseId === "apply" ? "Applied file changes" : "Rejected file changes",
          },
        });
      });

      // Handle the file response
      if (responseId === "apply") {
        // Apply the file changes
        const uri = Uri.file(path);
        await commands.executeCommand("konveyor.applyFile", uri);
      } else if (responseId === "reject") {
        // Reject the file changes
        const uri = Uri.file(path);
        await commands.executeCommand("konveyor.discardFile", uri);
      }

      // Create a workflow message to continue the workflow
      const workflowMessage: KaiWorkflowMessage = {
        id: messageToken,
        type: KaiWorkflowMessageType.UserInteraction,
        data: {
          type: "yesNo",
          response: {
            yesNo: responseId === "apply",
          },
        } as KaiUserIteraction,
      };

      if (!state.workflowManager.isInitialized) {
        console.error("Workflow not initialized");
        return;
      }

      const workflow = state.workflowManager.getWorkflow();
      await workflow.resolveUserInteraction(workflowMessage);
    } finally {
      // Clear loading state
      state.mutateData((draft) => {
        draft.isProcessingQuickResponse = false;
      });
    }
  },

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
