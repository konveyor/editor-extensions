import { setupWebviewMessageListener } from "./webviewMessageHandler";
import { ExtensionState } from "./extensionState";
import { sourceOptions, targetOptions } from "./config/labels";
import {
  WebviewPanel,
  window,
  commands,
  Uri,
  ConfigurationTarget,
  OpenDialogOptions,
  ViewColumn,
  workspace,
} from "vscode";

let fullScreenPanel: WebviewPanel | undefined;

function getFullScreenTab() {
  const tabs = window.tabGroups.all.flatMap((tabGroup) => tabGroup.tabs);
  return tabs.find((tab) => (tab.input as any)?.viewType?.endsWith("konveyor.konveyorGUIView"));
}

const commandsMap: (state: ExtensionState) => {
  [command: string]: (...args: any) => any;
} = (state) => {
  const { sidebarProvider, extensionContext } = state;
  return {
    "konveyor.startAnalyzer": async () => {
      const analyzerClient = state.analyzerClient;
      if (!(await analyzerClient.canAnalyze())) {
        return;
      }

      window.showInformationMessage("Starting analyzer...");
      analyzerClient.start();
    },
    "konveyor.runAnalysis": async () => {
      const analyzerClient = state.analyzerClient;
      if (!analyzerClient || !(await analyzerClient.canAnalyze())) {
        window.showErrorMessage("Analyzer must be started before run!");
        return;
      }
      analyzerClient.clearStoredRulesets();

      if (fullScreenPanel && fullScreenPanel.webview) {
        analyzerClient.runAnalysis(fullScreenPanel.webview);
      } else if (state.sidebarProvider && state.sidebarProvider.webview) {
        analyzerClient.runAnalysis(state.sidebarProvider.webview);
      } else {
        window.showErrorMessage("No webview available to run analysis!");
      }
    },
    "konveyor.focusKonveyorInput": async () => {
      const fullScreenTab = getFullScreenTab();
      if (!fullScreenTab) {
        commands.executeCommand("konveyor.konveyorGUIView.focus");
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
        commands.executeCommand("workbench.action.closeActiveEditor"); //this will trigger the onDidDispose listener below
        return;
      }

      if (fullScreenTab && fullScreenPanel) {
        //Full screen open, but not focused - focus it
        fullScreenPanel.reveal();
        return;
      }

      //create the full screen panel
      const panel = window.createWebviewPanel(
        "konveyor.konveyorFullScreenView",
        "Konveyor",
        ViewColumn.One,
        {
          retainContextWhenHidden: true,
          enableScripts: true,
          localResourceRoots: [
            Uri.joinPath(extensionContext.extensionUri, "media"),
            Uri.joinPath(extensionContext.extensionUri, "out"),
          ],
        },
      );
      fullScreenPanel = panel;

      panel.webview.html = sidebarProvider._getHtmlForWebview(panel.webview);

      setupWebviewMessageListener(panel.webview, state);

      panel.webview.onDidReceiveMessage(
        (message) => {
          if (message.command === "webviewReady") {
            console.log("Webview is ready");
            state.analyzerClient.populateWebviewWithStoredRulesets(panel.webview);
          }
        },
        undefined,
        extensionContext.subscriptions,
      );

      if (state.sidebarProvider) {
        commands.executeCommand("workbench.action.closeSidebar");
      }

      //When panel closes, reset the webview and focus
      panel.onDidDispose(
        () => {
          state.webviewProviders.delete(sidebarProvider);
          fullScreenPanel = undefined;
          commands.executeCommand("konveyor.focusKonveyorInput");
        },
        null,
        extensionContext.subscriptions,
      );
    },
    "konveyor.overrideAnalyzerBinaries": async () => {
      const options: OpenDialogOptions = {
        canSelectMany: false,
        openLabel: "Select Analyzer Binary",
        filters: {
          "Executable Files": ["exe", "sh", "bat", ""],
          "All Files": ["*"],
        },
      };

      const fileUri = await window.showOpenDialog(options);

      if (fileUri && fileUri[0]) {
        const filePath = fileUri[0].fsPath;

        // Update the user settings
        const config = workspace.getConfiguration("konveyor");
        await config.update("analyzerPath", filePath, ConfigurationTarget.Global);

        window.showInformationMessage(`Analyzer binary path updated to: ${filePath}`);
      } else {
        window.showInformationMessage("No analyzer binary selected.");
      }
    },
    "konveyor.configureCustomRules": async () => {
      const options: OpenDialogOptions = {
        canSelectMany: true,
        canSelectFolders: true,
        canSelectFiles: true,
        openLabel: "Select Custom Rules",
        filters: {
          "All Files": ["*"],
        },
      };

      const fileUris = await window.showOpenDialog(options);

      if (fileUris && fileUris.length > 0) {
        const customRules = fileUris.map((uri) => uri.fsPath);

        // TODO(djzager): Should we verify the rules provided are valid?

        // Update the user settings
        const config = workspace.getConfiguration("konveyor");
        await config.update("customRules", customRules, ConfigurationTarget.Workspace);

        // Ask the user if they want to disable the default ruleset
        const useDefaultRulesets = await window.showQuickPick(["Yes", "No"], {
          placeHolder: "Do you want to use the default rulesets?",
          canPickMany: false,
        });

        if (useDefaultRulesets === "Yes") {
          await config.update("useDefaultRulesets", true, ConfigurationTarget.Workspace);
        } else if (useDefaultRulesets === "No") {
          await config.update("useDefaultRulesets", false, ConfigurationTarget.Workspace);
        }

        window.showInformationMessage(
          `Custom Rules Updated: ${customRules}\nUse Default Rulesets: ${useDefaultRulesets}`,
        );
      } else {
        window.showInformationMessage("No custom rules selected.");
      }
    },
    "konveyor.configureSourcesTargets": async () => {
      const config = workspace.getConfiguration("konveyor");
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
        const result = await window.showQuickPick(
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
        window.showInformationMessage("No sources or targets selected.");
        return;
      }

      state.labelSelector = `(${[sources, targets].filter((part) => part !== "").join(" && ")}) || (discovery)`;

      // Show input box for modifying label selector
      const modifiedLabelSelector = await window.showInputBox({
        prompt: "Modify the label selector if needed",
        value: state.labelSelector,
        placeHolder: "e.g., source=(java|spring) target=(quarkus)",
      });

      if (modifiedLabelSelector === undefined) {
        return;
      }
      state.labelSelector = modifiedLabelSelector;

      // Update the user settings
      await config.update("labelSelector", state.labelSelector, ConfigurationTarget.Workspace);

      window.showInformationMessage(
        `Configuration updated: Sources: ${state.sources.join(", ")}, Targets: ${state.targets.join(", ")}, Label Selector: ${state.labelSelector}`,
      );
    },
    "konveyor.configureLabelSelector": async () => {
      const config = workspace.getConfiguration("konveyor");
      const currentLabelSelector = config.get<string>("labelSelector", "");

      const modifiedLabelSelector = await window.showInputBox({
        prompt: "Modify the label selector if needed",
        value: currentLabelSelector,
        placeHolder: "e.g., source=(java|spring) target=(quarkus)",
      });

      if (modifiedLabelSelector === undefined) {
        return;
      }

      // Update the user settings
      await config.update("labelSelector", modifiedLabelSelector, ConfigurationTarget.Workspace);
    },
  };
};

export function registerAllCommands(state: ExtensionState) {
  for (const [command, callback] of Object.entries(commandsMap(state))) {
    state.extensionContext.subscriptions.push(commands.registerCommand(command, callback));
  }
}
