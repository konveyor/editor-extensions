import * as vscode from "vscode";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import { setupWebviewMessageListener } from "./webviewMessageHandler";

let fullScreenPanel: vscode.WebviewPanel | undefined;

function getFullScreenTab() {
  const tabs = vscode.window.tabGroups.all.flatMap((tabGroup) => tabGroup.tabs);
  return tabs.find((tab) =>
    (tab.input as any)?.viewType?.endsWith("konveyor.konveyorGUIView"),
  );
}

const commandsMap: (
  extensionContext: vscode.ExtensionContext,
  sidebar: KonveyorGUIWebviewViewProvider,
) => { [command: string]: (...args: any) => any } = (
  extensionContext,
  sidebar,
) => {
  return {
    "konveyor.focusKonveyorInput": async () => {
      const fullScreenTab = getFullScreenTab();
      if (!fullScreenTab) {
        // focus sidebar
        vscode.commands.executeCommand("konveyor.konveyorGUIView.focus");
      } else {
        // focus fullscreen
        fullScreenPanel?.reveal();
      }
      // sidebar.webviewProtocol?.request("focusContinueInput", undefined);
      // await addHighlightedCodeToContext(sidebar.webviewProtocol);
    },
    "konveyor.toggleFullScreen": () => {
      // Check if full screen is already open by checking open tabs
      const fullScreenTab = getFullScreenTab();

      // Check if the active editor is the Continue GUI View
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
      panel.webview.html = sidebar.getSidebarContent(
        extensionContext,
        panel,
        true,
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
  sidebar: KonveyorGUIWebviewViewProvider
) {
  for (const [command, callback] of Object.entries(
    commandsMap(context, sidebar)
  )) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, callback),
    );
  }
}
