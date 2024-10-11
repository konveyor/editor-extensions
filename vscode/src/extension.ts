// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { VsCodeExtension } from "./VsCodeExtension";
import { AnalyzerClient } from "./client/analyzerClient";

let client: AnalyzerClient;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // TODO(djzager): This was in continue but I couldn't get it to work correctly.
  // const { activateExtension } = await import("./activate");
  try {
    const ext = new VsCodeExtension(context);
    client = ext.getAnalyzerClient();

    console.log("Extension activated");
  } catch (e) {
    console.log("Error activating extension: ", e);
    vscode.window
      .showInformationMessage(
        "Error activating the Konveyor extension.",
        //   "View Logs",
        "Retry",
      )
      .then((selection) => {
        //   if (selection === "View Logs") {
        // 	vscode.commands.executeCommand("konveyor.viewLogs");
        //   } else
        if (selection === "Retry") {
          // Reload VS Code window
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  if (!client) {
    return;
  }
  return client.stop();
}
