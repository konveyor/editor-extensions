import * as vscode from "vscode";
import { ExtensionState } from "./extensionState";
import { LocalChange } from "@editor-extensions/shared";

export function setupWebviewMessageListener(webview: vscode.Webview, state: ExtensionState) {
  webview.onDidReceiveMessage(async (message) => {
    switch (message.command) {
      // case "getRealSolution":{
      //   messa
      //   vscode.commands.executeCommand("konveyor.getSolution", incident);
      //   break;
      // }
      case "getSolution": {
        const { violation, incident } = message;
        vscode.commands.executeCommand("konveyor.getSolution", incident, violation);

        vscode.commands.executeCommand("konveyor.diffView.focus");
        vscode.commands.executeCommand("konveyor.showResolutionPanel");

        break;
      }
      case "getAllSolutions": {
        // vscode.commands.executeCommand("konveyor.getAllSolutions");
        vscode.commands.executeCommand("konveyor.diffView.focus");
        break;
      }
      case "viewFix": {
        vscode.commands.executeCommand(
          "konveyor.diffView.viewFix",
          vscode.Uri.from((message.change as LocalChange).originalUri),
          true,
        );
        break;
      }
      case "applyFile": {
        vscode.commands.executeCommand(
          "konveyor.applyFile",
          vscode.Uri.from((message.change as LocalChange).originalUri),
          true,
        );
        break;
      }
      case "discardFile": {
        vscode.commands.executeCommand(
          "konveyor.discardFile",
          vscode.Uri.from((message.change as LocalChange).originalUri),
          true,
        );
        break;
      }
      case "requestQuickfix": {
        const { uri, line } = message.data;
        await handleRequestQuickFix(uri, line);
        // Implement the quick fix logic here
        // For example, replace the problematic code with a suggested fix
        // const suggestedCode = message.diagnostic.message; // You might need to parse this appropriately
        // const action = new vscode.CodeAction("Apply Quick Fix", vscode.CodeActionKind.QuickFix);
        // action.edit = new vscode.WorkspaceEdit();
        // action.edit.replace(message.documentUri, message.range, suggestedCode);
        // action.diagnostics = [message.diagnostic];
        // action.isPreferred = true;
        // vscode.commands.executeCommand("vscode.executeCodeActionProvider", message.documentUri, message.range, action);
        break;
      }

      case "startAnalysis": {
        vscode.commands.executeCommand("konveyor.runAnalysis");
        break;
      }

      case "openFile": {
        const fileUri = vscode.Uri.parse(message.file);
        try {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          const editor = await vscode.window.showTextDocument(doc, {
            preview: true,
          });
          const position = new vscode.Position(message.line - 1, 0);
          const range = new vscode.Range(position, position);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to open file: ${error}`);
        }
        break;
      }
      case "checkServerStatus": {
        const isRunning = state.analyzerClient.isServerRunning();
        webview.postMessage({ type: "serverStatus", isRunning });
        console.log("checkServerStatus", isRunning);
        break;
      }
      case "startServer": {
        vscode.commands.executeCommand("konveyor.startAnalyzer");
        break;
      }
      case "solutionResolved": {
        console.log("solutionResolved");
        const sidebarProvider = state.webviewProviders.get("sidebar");
        sidebarProvider?.webview?.postMessage({
          type: "solutionConfirmation",
          data: { confirmed: true, solution: null },
        });
        // ?.sendMessageToWebview({
        //   type: "solutionConfirmation",
        //   data: { confirmed: true, solution: null },
        // });
        break;
      }

      // Add more cases as needed
    }
  });
}

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
