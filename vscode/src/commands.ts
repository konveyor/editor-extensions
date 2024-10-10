import { setupWebviewMessageListener } from "./webviewMessageHandler";
import { ExtensionState } from "./extensionState";
import { getWebviewContent } from "./webviewContent";
import { sourceOptions, targetOptions } from "./config/labels";
import { AnalysisConfig } from "./webview/types";
import { runAnalysis } from "./runAnalysis"; // Import the runAnalysis function
import * as vscode from "vscode";

let fullScreenPanel: vscode.WebviewPanel | undefined;

function getFullScreenTab() {
  const tabs = vscode.window.tabGroups.all.flatMap((tabGroup) => tabGroup.tabs);
  return tabs.find((tab) => (tab.input as any)?.viewType?.endsWith("konveyor.konveyorGUIView"));
}

const commandsMap: (state: ExtensionState) => {
  [command: string]: (...args: any) => any;
} = (state) => {
  const { sidebarProvider, extensionContext } = state;
  return {
    "konveyor.startAnalysis": async (resource: vscode.Uri) => {
      try {
        if (!resource || !resource.fsPath) {
          throw new Error("No folder selected for analysis.");
        }

        const stats = await vscode.workspace.fs.stat(resource);
        if (stats.type !== vscode.FileType.Directory) {
          throw new Error("Selected item is not a folder. Please select a folder for analysis.");
        }

        // Fetch the workspace configuration
        const config = vscode.workspace.getConfiguration("konveyor");

        // Get the label selector from the configuration
        const labelSelector = config.get<string>("labelSelector");

        // Get the custom rules from the configuration
        const customRules = config.get<string[]>("customRules");

        // Get the override analyzer binary path from the configuration
        const overrideAnalyzerBinaryPath = config.get<string>("overrideAnalyzerBinaryPath");

        // Create an object to hold the analysis configuration
        const analysisConfig: AnalysisConfig = {
          labelSelector,
          customRules,
          overrideAnalyzerBinaryPath,
          inputPath: resource.fsPath,
        };

        // Call the runAnalysis function with the necessary context, webview, and analysis configuration
        await runAnalysis(state, analysisConfig, state.sidebarProvider?.webview);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        state.sidebarProvider?.webview?.postMessage({
          type: "analysisFailed",
          message: errorMessage,
        });
        vscode.window.showErrorMessage(`Failed to start analysis: ${errorMessage}`);
      }
    },

    "konveyor.focusKonveyorInput": async () => {
      const fullScreenTab = getFullScreenTab();
      if (!fullScreenTab) {
        vscode.commands.executeCommand("konveyor.konveyorGUIView.focus");
      } else {
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
        "konveyor.konveyorFullScreenView",
        "Konveyor",
        vscode.ViewColumn.One,
        {
          retainContextWhenHidden: true,
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(extensionContext.extensionUri, "media"),
            vscode.Uri.joinPath(extensionContext.extensionUri, "out"),
          ],
        },
      );
      fullScreenPanel = panel;

      //Add content to the panel
      panel.webview.html = getWebviewContent(extensionContext, panel.webview, true);

      setupWebviewMessageListener(panel.webview, state);

      //When panel closes, reset the webview and focus
      panel.onDidDispose(
        () => {
          state.webviewProviders.delete(sidebarProvider);
          fullScreenPanel = undefined;
          vscode.commands.executeCommand("konveyor.focusKonveyorInput");
        },
        null,
        extensionContext.subscriptions,
      );
    },
    "konveyor.overrideAnalyzerBinaries": async () => {
      const options: vscode.OpenDialogOptions = {
        canSelectMany: false,
        openLabel: "Select Analyzer Binary",
        filters: {
          "Executable Files": ["exe", "sh", "bat", ""],
          "All Files": ["*"],
        },
      };

      const fileUri = await vscode.window.showOpenDialog(options);

      if (fileUri && fileUri[0]) {
        const filePath = fileUri[0].fsPath;

        // Update the user settings
        const config = vscode.workspace.getConfiguration("konveyor");
        await config.update("analyzerPath", filePath, vscode.ConfigurationTarget.Global);

        vscode.window.showInformationMessage(`Analyzer binary path updated to: ${filePath}`);
      } else {
        vscode.window.showInformationMessage("No analyzer binary selected.");
      }
    },
    "konveyor.configureCustomRules": async () => {
      const options: vscode.OpenDialogOptions = {
        canSelectMany: true,
        canSelectFolders: true,
        canSelectFiles: true,
        openLabel: "Select Custom Rules",
        filters: {
          "All Files": ["*"],
        },
      };

      const fileUris = await vscode.window.showOpenDialog(options);

      if (fileUris && fileUris.length > 0) {
        const customRules = fileUris.map((uri) => uri.fsPath);

        // TODO(djzager): Should we verify the rules provided are valid?

        // Update the user settings
        const config = vscode.workspace.getConfiguration("konveyor");
        await config.update("customRules", customRules, vscode.ConfigurationTarget.Workspace);

        // Ask the user if they want to disable the default ruleset
        const useDefaultRulesets = await vscode.window.showQuickPick(["Yes", "No"], {
          placeHolder: "Do you want to use the default rulesets?",
          canPickMany: false,
        });

        if (useDefaultRulesets === "Yes") {
          await config.update("useDefaultRulesets", true, vscode.ConfigurationTarget.Workspace);
        } else if (useDefaultRulesets === "No") {
          await config.update("useDefaultRulesets", false, vscode.ConfigurationTarget.Workspace);
        }

        vscode.window.showInformationMessage(
          `Custom Rules Updated: ${customRules}\nUse Default Rulesets: ${useDefaultRulesets}`,
        );
      } else {
        vscode.window.showInformationMessage("No custom rules selected.");
      }
    },
    "konveyor.configureSourcesTargets": async () => {
      const config = vscode.workspace.getConfiguration("konveyor");
      const currentLabelSelector = config.get<string>("labelSelector", "");

      // Function to extract values from label selector
      const extractValuesFromSelector = (selector: string, key: string): string[] => {
        const regex = new RegExp(`konveyor.io/${key}=(.*?)(?:\\s|$)`, "g");
        const matches = selector.matchAll(regex);
        const values = Array.from(matches, (match) => match[1]);
        return values.flatMap((value) => value.split("|"));
      };

      // Extract sources and targets from the current label selector
      const currentSources = extractValuesFromSelector(currentLabelSelector, "source");
      const currentTargets = extractValuesFromSelector(currentLabelSelector, "target");

      const state: { sources: string[]; targets: string[]; labelSelector: string } = {
        sources: [],
        targets: [],
        labelSelector: "",
      };

      // Function to show QuickPick for sources and targets
      const showQuickPick = async (
        title: string,
        placeholder: string,
        items: string[],
        selectedItems: string[],
      ): Promise<string[] | undefined> => {
        const result = await vscode.window.showQuickPick(
          items.map((item) => ({
            label: item,
            picked: selectedItems.includes(item),
          })),
          {
            canPickMany: true,
            placeHolder: placeholder,
            title: title,
          },
        );
        if (result === undefined) {
          return undefined;
        }
        return result.map((item) => item.label);
      };

      // Show QuickPick for sources
      const selectedSources = await showQuickPick(
        "Select Source Technologies",
        "Choose one or more source technologies",
        sourceOptions,
        currentSources,
      );
      if (selectedSources === undefined) {
        return;
      }
      state.sources = selectedSources;

      // Show QuickPick for targets
      const selectedTargets = await showQuickPick(
        "Select Target Technologies",
        "Choose one or more target technologies",
        targetOptions,
        currentTargets,
      );
      if (selectedTargets === undefined) {
        return;
      }
      state.targets = selectedTargets;

      // Compute initial label selector
      const sources = state.sources.map((source) => `konveyor.io/source=${source}`).join(" || ");
      const targets = state.targets.map((target) => `konveyor.io/target=${target}`).join(" || ");
      if (sources === "" && targets === "") {
        vscode.window.showInformationMessage("No sources or targets selected.");
        return;
      }

      state.labelSelector = `(${[sources, targets].filter((part) => part !== "").join(" && ")}) || (discovery)`;

      // Show input box for modifying label selector
      const modifiedLabelSelector = await vscode.window.showInputBox({
        prompt: "Modify the label selector if needed",
        value: state.labelSelector,
        placeHolder: "e.g., source=(java|spring) target=(quarkus)",
      });

      if (modifiedLabelSelector === undefined) {
        return;
      }
      state.labelSelector = modifiedLabelSelector;

      // Update the user settings
      await config.update(
        "labelSelector",
        state.labelSelector,
        vscode.ConfigurationTarget.Workspace,
      );

      vscode.window.showInformationMessage(
        `Configuration updated: Sources: ${state.sources.join(", ")}, Targets: ${state.targets.join(", ")}, Label Selector: ${state.labelSelector}`,
      );
    },
    "konveyor.configureLabelSelector": async () => {
      const config = vscode.workspace.getConfiguration("konveyor");
      const currentLabelSelector = config.get<string>("labelSelector", "");

      const modifiedLabelSelector = await vscode.window.showInputBox({
        prompt: "Modify the label selector if needed",
        value: currentLabelSelector,
        placeHolder: "e.g., source=(java|spring) target=(quarkus)",
      });

      if (modifiedLabelSelector === undefined) {
        return;
      }

      // Update the user settings
      await config.update(
        "labelSelector",
        modifiedLabelSelector,
        vscode.ConfigurationTarget.Workspace,
      );
    },
  };
};

export function registerAllCommands(state: ExtensionState) {
  for (const [command, callback] of Object.entries(commandsMap(state))) {
    state.extensionContext.subscriptions.push(vscode.commands.registerCommand(command, callback));
  }
}
