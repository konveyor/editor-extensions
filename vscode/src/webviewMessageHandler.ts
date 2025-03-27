import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import {
  APPLY_FILE,
  DISCARD_FILE,
  GET_SOLUTION,
  GET_SOLUTION_WITH_KONVEYOR_CONTEXT,
  LocalChange,
  OPEN_FILE,
  RUN_ANALYSIS,
  Scope,
  START_SERVER,
  STOP_SERVER,
  VIEW_FIX,
  WEBVIEW_READY,
  WebviewAction,
  WebviewActionType,
  EnhancedIncident,
  ScopeWithKonveyorContext,
} from "@editor-extensions/shared";
import { getConfigPromptTemplate } from "./utilities/configuration";
import Mustache from "mustache";

export function setupWebviewMessageListener(webview: vscode.Webview, _state: ExtensionState) {
  webview.onDidReceiveMessage(async (message) => messageHandler(message));
}

function getPromptForIncident(incident: EnhancedIncident): string {
  const promptTemplate = getConfigPromptTemplate();
  return Mustache.render(promptTemplate, incident);
}

const actions: {
  [name: string]: (payload: any) => void;
} = {
  [WEBVIEW_READY]() {
    console.log("Webview is ready");
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
  [GET_SOLUTION_WITH_KONVEYOR_CONTEXT]({ incident }: ScopeWithKonveyorContext) {
    if (!incident.lineNumber) {
      console.error("Incident has no line number:", incident);
      return;
    }

    const lineNumber = incident.lineNumber - 1; // Convert to 0-based index

    // Open the document and get surrounding context
    void (async () => {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(incident.uri));
        const startLine = Math.max(0, lineNumber - 5);
        const endLine = Math.min(doc.lineCount - 1, lineNumber + 5);

        // Show the document in the editor
        const editor = await vscode.window.showTextDocument(doc, { preview: true });

        // Move cursor to the incident line
        const position = new vscode.Position(lineNumber, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter,
        );

        // Execute the Continue command with prompt and range
        await vscode.commands.executeCommand(
          "continue.customQuickActionSendToChat",
          getPromptForIncident(incident),
          new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(endLine, doc.lineAt(endLine).text.length),
          ),
        );
      } catch (error) {
        console.error("Failed to open document:", error);
        vscode.window.showErrorMessage(
          `Failed to open document: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    })();
  },
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

export const messageHandler = async (message: WebviewAction<WebviewActionType, unknown>) => {
  console.log("Received message inside message handler...", message);
  const handler = actions?.[message?.type];
  if (handler) {
    await handler(message.payload);
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
