import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import {
  ADD_PROFILE,
  AnalysisProfile,
  APPLY_FILE,
<<<<<<< HEAD
  CONFIGURE_CUSTOM_RULES,
  CONFIGURE_LABEL_SELECTOR,
  CONFIGURE_SOURCES_TARGETS,
=======
  DELETE_PROFILE,
>>>>>>> 9842302 (Initial changes for profile creation setting)
  DISCARD_FILE,
  GET_SOLUTION,
  GET_SOLUTION_WITH_KONVEYOR_CONTEXT,
  LocalChange,
  OPEN_FILE,
<<<<<<< HEAD
  OPEN_GENAI_SETTINGS,
  OVERRIDE_ANALYZER_BINARIES,
  OVERRIDE_RPC_SERVER_BINARIES,
=======
  OPEN_PROFILE_MANAGER,
>>>>>>> 9842302 (Initial changes for profile creation setting)
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
import { updateConfigActiveProfileName, updateConfigProfiles } from "./utilities/configuration";

export function setupWebviewMessageListener(webview: vscode.Webview, state: ExtensionState) {
  webview.onDidReceiveMessage(async (message) => {
    await messageHandler(message, state);
  });
}

const actions: {
  [name: string]: (payload: any, state: ExtensionState) => void | Promise<void>;
} = {
  [ADD_PROFILE]: async (profile: AnalysisProfile, state: ExtensionState) => {
    console.log("Adding profile:", profile);
    const profiles = state.data.profiles;
    const activeProfileName = state.data.activeProfileName;
    const existingProfile = profiles.find((p) => p.name === profile.name);
    if (existingProfile) {
      console.error("Profile already exists:", profile.name);
      return;
    }
    state.mutateData((draft) => {
      draft.profiles.push(profile);
    });
    await updateConfigProfiles([...profiles, profile]); // <== add this

    await updateConfigActiveProfileName(profile.name);
    console.log("✅ Profile added:", profile.name);
  },
  [DELETE_PROFILE]: async (profileName: string, state: ExtensionState) => {
    console.log("Deleting profile:", profileName);
    const profiles = state.data.profiles;
    const profileIndex = profiles.findIndex((p) => p.name === profileName);
    if (profileIndex === -1) {
      console.error("Profile not found:", profileName);
      return;
    }
    state.mutateData((draft) => {
      draft.profiles.splice(profileIndex, 1);
    });
    await updateConfigProfiles([
      ...profiles.slice(0, profileIndex),
      ...profiles.slice(profileIndex + 1),
    ]);

    console.log("✅ Profile deleted:", profileName);
  },
  [UPDATE_PROFILE]: async (
    payload: { originalName: string; updatedProfile: AnalysisProfile },
    state: ExtensionState,
  ) => {
    const { originalName, updatedProfile } = payload;
    console.log("Updating profile:", originalName, "→", updatedProfile.name);

    const profiles = state.data.profiles;
    const profileIndex = profiles.findIndex((p) => p.name === originalName);
    if (profileIndex === -1) {
      console.error("Profile not found:", originalName);
      return;
    }

    state.mutateData((draft) => {
      draft.profiles[profileIndex] = updatedProfile;
    });

    await updateConfigProfiles([
      ...profiles.slice(0, profileIndex),
      updatedProfile,
      ...profiles.slice(profileIndex + 1),
    ]);

    await updateConfigActiveProfileName(updatedProfile.name);
    console.log("✅ Profile updated:", updatedProfile.name);
  },

  [OPEN_PROFILE_MANAGER]() {
    vscode.commands.executeCommand("konveyor.openProfilesPanel");
  },
  [WEBVIEW_READY]() {
    console.log("Webview is ready");
  },
  [CONFIGURE_SOURCES_TARGETS]() {
    console.log("Configuring sources and targets...");
    vscode.commands.executeCommand("konveyor.configureSourcesTargets");
  },
  [CONFIGURE_LABEL_SELECTOR]() {
    console.log("Configuring label selector...");
    vscode.commands.executeCommand("konveyor.configureLabelSelector");
  },
  [OVERRIDE_ANALYZER_BINARIES]() {
    console.log("Overriding analyzer binaries...");
    vscode.commands.executeCommand("konveyor.overrideAnalyzerBinaries");
  },
  [OVERRIDE_RPC_SERVER_BINARIES]() {
    console.log("Overriding RPC server binaries...");
    vscode.commands.executeCommand("konveyor.overrideKaiRpcServerBinaries");
  },
  [CONFIGURE_CUSTOM_RULES]() {
    console.log("Configuring custom rules...");
    vscode.commands.executeCommand("konveyor.configureCustomRules");
  },
  [OPEN_GENAI_SETTINGS]() {
    console.log("Opening GenAI settings...");
    vscode.commands.executeCommand("konveyor.modelProviderSettingsOpen");
  },
  [GET_SOLUTION](scope: Scope) {
    vscode.commands.executeCommand("konveyor.getSolution", scope.incidents, scope.effort);

    vscode.commands.executeCommand("konveyor.diffView.focus");
    vscode.commands.executeCommand("konveyor.showResolutionPanel");
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
<<<<<<< HEAD
  async [GET_SOLUTION_WITH_KONVEYOR_CONTEXT]({ incident }: ScopeWithKonveyorContext) {
    vscode.commands.executeCommand("konveyor.askContinue", incident);
  },
=======

  [SET_ACTIVE_PROFILE]: async (profileName: string) => {
    await updateConfigActiveProfileName(profileName);
    console.log("✅ Active profile set to:", profileName);
  },

>>>>>>> 9842302 (Initial changes for profile creation setting)
  // [REQUEST_QUICK_FIX]({uri,line}){
  // await handleRequestQuickFix(uri, line);
  // Implement the quick fix logic here
  // For example, replace the problematic code with a suggested fix
  // const suggestedCode = message.diagnostic.message; // You might need to parse this appropriately
  // const action = new vscode.CodeAction("Apply Quick Fix", vscode.CodeActionKind.QuickFix);
  // action.edit = new vscode.WorkspaceEdit();
  // action.edit.replace(message.documentUri, message.range, suggestedCode);
  // action.diagnostics = [message.diagnostic];
  // action.isPreferred = true;
  // vscode.commands.executeCommand("vscode.executeCodeActionProvider", message.documentUri, message.range, action);
  // },
  [RUN_ANALYSIS]() {
    console.log("Running analysis...");
    vscode.commands.executeCommand("konveyor.runAnalysis");
  },
  async [OPEN_FILE]({ file, line }) {
    const fileUri = vscode.Uri.parse(file);
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(doc, {
        preview: true,
      });
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
  console.log("Received message inside message handler...", message);
  const handler = actions?.[message?.type];
  if (handler) {
    await handler(message.payload, state); // 🧠 pass state here
  } else {
    defaultHandler(message);
  }
};

const defaultHandler = (message: WebviewAction<WebviewActionType, unknown>) => {
  console.error("Unknown message received from webview", message);
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleRequestQuickFix(uriString: string, lineNumber: number) {
  const uri = vscode.Uri.parse(uriString);
  try {
    // Open the document
    const document = await vscode.workspace.openTextDocument(uri);

    // Show the document in the editor
    const editor = await vscode.window.showTextDocument(document, { preview: false });

    // Move the cursor to the specified line and character
    const position = new vscode.Position(lineNumber - 1, 0); // Adjust line number (0-based index)
    const range = new vscode.Range(position, position);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

    // Trigger the quick fix action at the cursor position
    await vscode.commands.executeCommand("editor.action.quickFix");
  } catch (error: any) {
    vscode.window.showErrorMessage(`Could not open file: ${error?.message as string}`);
  }
}
