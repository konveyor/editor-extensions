import * as vscode from "vscode";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import { setupWebviewMessageListener } from "./webviewMessageHandler";
import { ExtensionState } from "./extensionState";
import { getWebviewContent } from "./webviewContent";

let fullScreenPanel: vscode.WebviewPanel | undefined;

function getFullScreenTab() {
  const tabs = vscode.window.tabGroups.all.flatMap((tabGroup) => tabGroup.tabs);
  return tabs.find((tab) =>
    (tab.input as any)?.viewType?.endsWith("konveyor.konveyorGUIView"),
  );
}

const commandsMap: (
  extensionContext: vscode.ExtensionContext,
  state: ExtensionState
) => {
  [command: string]: (...args: any) => any;
} = (extensionContext, state) => {
  const { sidebarProvider } = state;
  return {
    "konveyor.startAnalysis": async (resource: vscode.Uri) => {
      if (!resource) {
        vscode.window.showErrorMessage("No file selected for analysis.");
        return;
      }

      // Get the file path
      const filePath = resource.fsPath;

      // Perform your analysis logic here
      try {
        // For example, read the file content
        const fileContent = await vscode.workspace.fs.readFile(resource);
        const contentString = Buffer.from(fileContent).toString("utf8");

        console.log(contentString, fileContent);

        // TODO: Analyze the file content
        vscode.window.showInformationMessage(`Analyzing file: ${filePath}`);

        // Call your analysis function/module
        // analyzeFileContent(contentString);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to analyze file: ${error}`);
      }
    },

    "konveyor.focusKonveyorInput": async () => {
      const fullScreenTab = getFullScreenTab();
      if (!fullScreenTab) {
        // focus sidebar
        vscode.commands.executeCommand("konveyor.konveyorGUIView.focus");
      } else {
        // focus fullscreen
        fullScreenPanel?.reveal();
      }
      // sidebar.webviewProtocol?.request("focusInput", undefined);
      // await addHighlightedCodeToContext(sidebar.webviewProtocol);
    },
    "konveyor.toggleFullScreen": () => {
      // Check if full screen is already open by checking open tabs
      const fullScreenTab = getFullScreenTab();

      // Check if the active editor is the GUI View
      if (fullScreenTab && fullScreenTab.isActive) {
        //Full screen open and focused - close it
        vscode.commands.executeCommand("workbench.action.closeActiveEditor"); //this will trigger the onDidDispose listener below
        return;
      }

      if (fullScreenTab && fullScreenPanel) {
        //Full screen open, but not focused - focus it
        fullScreenPanel.reveal();
        return;
      }

      //create the full screen panel
      const panel = vscode.window.createWebviewPanel(
        "konveyor.konveyorGUIView",
        "Konveyor",
        vscode.ViewColumn.One,
        {
          retainContextWhenHidden: true,
          enableScripts: true,
        },
      );
      fullScreenPanel = panel;

      //Add content to the panel
      panel.webview.html = getWebviewContent(
        extensionContext,
        sidebarProvider?.webview || panel.webview,
        true
      );

      setupWebviewMessageListener(panel.webview);

      //When panel closes, reset the webview and focus
      panel.onDidDispose(
        () => {
          vscode.commands.executeCommand("konveyor.focusKonveyorInput");
        },
        null,
        extensionContext.subscriptions,
      );
    },
  };
};

export function registerAllCommands(
  context: vscode.ExtensionContext,
  state: ExtensionState
) {
  for (const [command, callback] of Object.entries(
    commandsMap(context, state)
  )) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, callback),
    );
  }
}
