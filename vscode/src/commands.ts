import { ExtensionState } from "./extensionState";
import {
  window,
  commands,
  Uri,
  OpenDialogOptions,
  workspace,
  Range,
  Selection,
  TextEditorRevealType,
  Position,
} from "vscode";
import {
  cleanRuleSets,
  loadResultsFromDataFolder,
  loadRuleSets,
  loadSolution,
  loadStaticResults,
} from "./data";
import {
  EnhancedIncident,
  RuleSet,
  Scope,
  Solution,
  SolutionEffortLevel,
  ChatMessageType,
  GetSolutionResult,
} from "@editor-extensions/shared";
import {
  type KaiWorkflowMessage,
  type KaiInteractiveWorkflowInput,
} from "@editor-extensions/agentic";
import {
  applyAll,
  discardAll,
  copyDiff,
  copyPath,
  FileItem,
  viewFix,
  applyFile,
  discardFile,
  applyBlock,
} from "./diffView";
import {
  updateAnalyzerPath,
  updateKaiRpcServerPath,
  updateGetSolutionMaxDepth,
  updateGetSolutionMaxIterations,
  updateGetSolutionMaxPriority,
  getConfigAgentMode,
  getConfigSuperAgentMode,
} from "./utilities/configuration";
import { runPartialAnalysis } from "./analysis";
import { fixGroupOfIncidents, IncidentTypeItem } from "./issueView";
import { paths } from "./paths";
import { checkIfExecutable, copySampleProviderSettings } from "./utilities/fileUtils";
import { handleConfigureCustomRules } from "./utilities/profiles/profileActions";
import { getModelConfig, ModelProvider } from "./client/modelProvider";
import { createPatch, createTwoFilesPatch } from "diff";
import { v4 as uuidv4 } from "uuid";
import { notifyWebviewOfFileAction } from "./utilities/ModifiedFiles/notifyWebviewOfFileAction";
import { processMessage } from "./utilities/ModifiedFiles/processMessage";

const isWindows = process.platform === "win32";

const commandsMap: (state: ExtensionState) => {
  [command: string]: (...args: any) => any;
} = (state) => {
  return {
    "konveyor.notifyWebviewOfFileAction": async (payload: {
      path: string;
      action: string;
      messageToken?: string;
    }) => {
      notifyWebviewOfFileAction(state, payload);
    },
    "konveyor.openProfilesPanel": async () => {
      const provider = state.webviewProviders.get("profiles");
      if (provider) {
        provider.showWebviewPanel();
      } else {
        console.error("Profiles provider not found");
      }
    },
    "konveyor.startServer": async () => {
      const analyzerClient = state.analyzerClient;
      if (!(await analyzerClient.canAnalyzeInteractive())) {
        return;
      }
      try {
        await analyzerClient.start();
      } catch (e) {
        console.error("Could not start the server", e);
      }
    },
    "konveyor.stopServer": async () => {
      const analyzerClient = state.analyzerClient;
      try {
        await analyzerClient.stop();
      } catch (e) {
        console.error("Could not shutdown and stop the server", e);
      }
    },
    "konveyor.restartServer": async () => {
      const analyzerClient = state.analyzerClient;
      try {
        if (analyzerClient.isServerRunning()) {
          await analyzerClient.stop();
        }

        if (!(await analyzerClient.canAnalyzeInteractive())) {
          return;
        }
        await analyzerClient.start();
      } catch (e) {
        console.error("Could not restart the server", e);
      }
    },
    "konveyor.runAnalysis": async () => {
      const analyzerClient = state.analyzerClient;
      if (!analyzerClient || !analyzerClient.canAnalyze()) {
        window.showErrorMessage("Analyzer must be started and configured before run!");
        return;
      }
      analyzerClient.runAnalysis();
    },
    "konveyor.getSolution": async (incidents: EnhancedIncident[], effort: SolutionEffortLevel) => {
      await commands.executeCommand("konveyor.showResolutionPanel");

      // Create a scope for the solution
      const scope: Scope = { incidents, effort };

      const clientId = uuidv4();
      state.solutionServerClient.setClientId(clientId);

      // Update the state to indicate we're starting to fetch a solution
      // Clear previous chat messages to prevent duplicate diff viewers
      state.mutateData((draft) => {
        draft.isFetchingSolution = true;
        draft.solutionState = "started";
        draft.solutionScope = scope;
        draft.chatMessages = []; // Clear previous chat messages
      });

      try {
        // Get the model provider configuration from settings YAML
        const modelConfig = await getModelConfig(paths().settingsYaml);
        if (!modelConfig) {
          throw new Error("Model provider configuration not found in settings YAML.");
        }

        // Initialize the appropriate model based on the config
        const model = ModelProvider.fromConfig(modelConfig);

        // Get the profile name from the incidents
        const profileName = incidents[0]?.activeProfileName;
        if (!profileName) {
          window.showErrorMessage("No profile name found in incidents");
          return;
        }

        // Initialize workflow if agent mode is enabled
        // Create array to store all diffs
        const allDiffs: { original: string; modified: string; diff: string }[] = [];

        if (getConfigAgentMode()) {
          // Set the state to indicate we're fetching a solution

          await state.workflowManager.init({
            model: model,
            workspaceDir: state.data.workspaceRoot,
            solutionServerClient: state.solutionServerClient,
          });

          // Get the workflow instance
          const workflow = state.workflowManager.getWorkflow();
          // Track processed message tokens to prevent duplicates
          const processedTokens = new Set<string>();

          // TODO (pgaikwad) - revisit this
          // this is a number I am setting for demo purposes
          // until we have a full UI support. we will only
          // process child issues until the depth of 1
          const maxTaskManagerIterations = 1;
          const currentTaskManagerIterations = 0;
          // Clear any existing modified files state at the start of a new solution
          state.modifiedFiles.clear();
          const modifiedFilesPromises: Array<Promise<void>> = [];
          // Queue to store messages that arrive while waiting for user interaction
          const messageQueue: KaiWorkflowMessage[] = [];
          // Map to store promise resolvers for user interactions
          const pendingInteractions = new Map<string, (response: any) => void>();

          // Store the resolver function in the state so webview handler can access it
          state.resolvePendingInteraction = (messageId: string, response: any) => {
            const resolver = pendingInteractions.get(messageId);
            if (resolver) {
              pendingInteractions.delete(messageId);
              resolver(response);
              return true;
            }
            return false;
          };

          // Set up the event listener to use our message processing function

          workflow.removeAllListeners();
          workflow.on("workflowMessage", async (msg: KaiWorkflowMessage) => {
            await processMessage(
              msg,
              state,
              workflow,
              messageQueue,
              modifiedFilesPromises,
              processedTokens,
              pendingInteractions,
              currentTaskManagerIterations,
              maxTaskManagerIterations,
            );
          });

          try {
            await workflow.run({
              incidents,
              migrationHint: profileName,
              programmingLanguage: "Java",
              enableAdditionalInformation: getConfigAgentMode(),
              enableDiagnostics: getConfigSuperAgentMode(),
            } as KaiInteractiveWorkflowInput);
          } catch (err) {
            console.error(`Error in running the agent - ${err}`);
            console.info(`Error trace - `, err instanceof Error ? err.stack : "N/A");
            window.showInformationMessage(`We encountered an error running the agent.`);
          } finally {
            // Ensure isFetchingSolution is reset even if workflow fails unexpectedly
            state.mutateData((draft) => {
              draft.isFetchingSolution = false;
              if (draft.solutionState === "started") {
                draft.solutionState = "failedOnSending";
              }
            });
          }

          // Process diffs from modified files
          await Promise.all(
            Array.from(state.modifiedFiles.entries()).map(async ([path, fileState]) => {
              const { originalContent, modifiedContent } = fileState;
              const uri = Uri.file(path);
              const relativePath = workspace.asRelativePath(uri);
              try {
                if (!originalContent) {
                  allDiffs.push({
                    diff: createTwoFilesPatch("", relativePath, "", modifiedContent),
                    modified: relativePath,
                    original: "",
                  });
                } else {
                  allDiffs.push({
                    diff: createPatch(relativePath, originalContent, modifiedContent),
                    modified: relativePath,
                    original: relativePath,
                  });
                }
              } catch (err) {
                console.error(`Error in processing diff - ${err}`);
              }
            }),
          );

          // Reset the cache after all processing is complete
          state.kaiFsCache.reset();
        }

        if (allDiffs.length === 0) {
          throw new Error("No diffs found in the response");
        }

        // Create a solution response with properly structured changes
        const solutionResponse: GetSolutionResult = {
          changes: allDiffs,
          encountered_errors: [],
          scope: { incidents, effort },
          clientId: clientId,
        };

        // Update the state with the solution
        state.mutateData((draft) => {
          draft.solutionState = "received";
          draft.isFetchingSolution = false;
          draft.solutionData = solutionResponse;

          // Only add the success message if we're not in agent mode
          // In agent mode, we'll add this message after all file modifications have been processed
          if (!getConfigAgentMode()) {
            draft.chatMessages.push({
              messageToken: `m${Date.now()}`,
              kind: ChatMessageType.String,
              value: { message: "Solution generated successfully!" },
              timestamp: new Date().toISOString(),
            });
          }
        });

        // Load the solution
        if (!getConfigAgentMode()) {
          commands.executeCommand("konveyor.loadSolution", solutionResponse, { incidents });
        }
      } catch (error: any) {
        console.error("Error in getSolution:", error);

        // Update the state to indicate an error
        state.mutateData((draft) => {
          draft.solutionState = "failedOnSending";
          draft.isFetchingSolution = false;
          draft.chatMessages.push({
            messageToken: `m${Date.now()}`,
            kind: ChatMessageType.String,
            value: { message: `Error: ${error.message}` },
            timestamp: new Date().toISOString(),
          });
        });

        window.showErrorMessage(`Failed to generate solution: ${error.message}`);
      }
    },
    "konveyor.askContinue": async (incident: EnhancedIncident) => {
      // This should be a redundant check as we shouldn't render buttons that
      // map to this command when continue is not installed.
      if (!state.data.isContinueInstalled) {
        window.showErrorMessage("The Continue extension is not installed");
        return;
      }

      const lineNumber = (incident.lineNumber ?? 1) - 1; // Convert to 0-based index

      // Open the document and get surrounding context
      try {
        const doc = await workspace.openTextDocument(Uri.parse(incident.uri));
        const startLine = Math.max(0, lineNumber - 5);
        const endLine = Math.min(doc.lineCount - 1, lineNumber + 5);

        // Show the document in the editor
        const editor = await window.showTextDocument(doc, { preview: true });

        // Move cursor to the incident line
        const position = new Position(lineNumber, 0);
        editor.selection = new Selection(position, position);
        editor.revealRange(new Range(position, position), TextEditorRevealType.InCenter);

        // Execute the Continue command with prompt and range
        await commands.executeCommand(
          "continue.customQuickActionSendToChat",
          `Help me address this Konveyor migration issue:\nRule: ${incident.ruleset_name} - ${incident.ruleset_description}\nViolation: ${incident.violation_name} - ${incident.violation_description}\nCategory: ${incident.violation_category}\nMessage: ${incident.message}`,
          new Range(
            new Position(startLine, 0),
            new Position(endLine, doc.lineAt(endLine).text.length),
          ),
        );
      } catch (error) {
        console.error("Failed to open document:", error);
        window.showErrorMessage(
          `Failed to open document: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    "konveyor.overrideAnalyzerBinaries": async () => {
      const options: OpenDialogOptions = {
        canSelectMany: false,
        openLabel: "Select Analyzer Binary",
        filters: isWindows
          ? {
              "Executable Files": ["exe"],
              "All Files": ["*"],
            }
          : {
              "All Files": ["*"],
            },
      };

      const fileUri = await window.showOpenDialog(options);
      if (fileUri && fileUri[0]) {
        const filePath = fileUri[0].fsPath;

        const isExecutable = await checkIfExecutable(filePath);
        if (!isExecutable) {
          window.showErrorMessage(
            `The selected file "${filePath}" is not executable. Please select a valid executable file.`,
          );
          return;
        }

        // Update the user settings
        await updateAnalyzerPath(filePath);

        window.showInformationMessage(`Analyzer binary path updated to: ${filePath}`);
      } else {
        // Reset the setting to undefined or remove it
        await updateAnalyzerPath(undefined);
        window.showInformationMessage("No analyzer binary selected.");
      }
    },
    "konveyor.overrideKaiRpcServerBinaries": async () => {
      const options: OpenDialogOptions = {
        canSelectMany: false,
        openLabel: "Select Rpc Server Binary",
        filters: isWindows
          ? {
              "Executable Files": ["exe"],
              "All Files": ["*"],
            }
          : {
              "All Files": ["*"],
            },
      };

      const fileUri = await window.showOpenDialog(options);
      if (fileUri && fileUri[0]) {
        const filePath = fileUri[0].fsPath;

        const isExecutable = await checkIfExecutable(filePath);
        if (!isExecutable) {
          window.showErrorMessage(
            `The selected file "${filePath}" is not executable. Please select a valid executable file.`,
          );
          return;
        }

        // Update the user settings
        await updateKaiRpcServerPath(filePath);

        window.showInformationMessage(`Rpc server binary path updated to: ${filePath}`);
      } else {
        // Reset the setting to undefined or remove it
        await updateKaiRpcServerPath(undefined);
        window.showInformationMessage("No Kai rpc-server binary selected.");
      }
    },
    "konveyor.modelProviderSettingsOpen": async () => {
      const settingsDocument = await workspace.openTextDocument(paths().settingsYaml);
      window.showTextDocument(settingsDocument);
    },
    "konveyor.modelProviderSettingsBackupReset": async () => {
      await copySampleProviderSettings(true);
      const settingsDocument = await workspace.openTextDocument(paths().settingsYaml);
      window.showTextDocument(settingsDocument);
    },
    "konveyor.configureCustomRules": async (profileId: string) => {
      await handleConfigureCustomRules(profileId, state);
    },
    "konveyor.loadRuleSets": async (ruleSets: RuleSet[]) => loadRuleSets(state, ruleSets),
    "konveyor.cleanRuleSets": () => cleanRuleSets(state),
    "konveyor.loadStaticResults": loadStaticResults,
    "konveyor.loadResultsFromDataFolder": loadResultsFromDataFolder,
    "konveyor.loadSolution": async (solution: Solution, scope?: Scope) =>
      loadSolution(state, solution, scope),
    "konveyor.applyAll": async () => applyAll(state),
    "konveyor.applyFile": async (item: FileItem | Uri) => applyFile(item, state),
    "konveyor.copyDiff": async (item: FileItem | Uri) => copyDiff(item, state),
    "konveyor.copyPath": copyPath,
    "konveyor.diffView.viewFix": viewFix,
    "konveyor.discardAll": async () => discardAll(state),
    "konveyor.discardFile": async (item: FileItem | Uri) => discardFile(item, state),
    "konveyor.showResolutionPanel": () => {
      const resolutionProvider = state.webviewProviders?.get("resolution");
      resolutionProvider?.showWebviewPanel();
    },
    "konveyor.showAnalysisPanel": () => {
      const resolutionProvider = state.webviewProviders?.get("sidebar");
      resolutionProvider?.showWebviewPanel();
    },
    "konveyor.openAnalysisDetails": async (item: IncidentTypeItem) => {
      //TODO: pass the item to webview and move the focus
      console.log("Open details for ", item);
      const resolutionProvider = state.webviewProviders?.get("sidebar");
      resolutionProvider?.showWebviewPanel();
    },
    "konveyor.fixGroupOfIncidents": fixGroupOfIncidents,
    "konveyor.fixIncident": fixGroupOfIncidents,
    "konveyor.diffView.applyBlock": applyBlock,
    "konveyor.diffView.applyBlockInline": applyBlock,
    "konveyor.diffView.applySelection": applyBlock,
    "konveyor.diffView.applySelectionInline": applyBlock,
    "konveyor.partialAnalysis": async (filePaths: Uri[]) => runPartialAnalysis(state, filePaths),
    "konveyor.configureGetSolutionParams": async () => {
      const maxPriorityInput = await window.showInputBox({
        prompt: "Enter max_priority for getSolution",
        placeHolder: "0",
        validateInput: (value) => {
          return isNaN(Number(value)) ? "Please enter a valid number" : null;
        },
      });

      if (maxPriorityInput === undefined) {
        return;
      }

      const maxPriority = Number(maxPriorityInput);

      const maxDepthInput = await window.showInputBox({
        prompt: "Enter max_depth for getSolution",
        placeHolder: "0",
        validateInput: (value) => {
          return isNaN(Number(value)) ? "Please enter a valid number" : null;
        },
      });

      if (maxDepthInput === undefined) {
        return;
      }

      const maxDepth = Number(maxDepthInput);

      const maxIterationsInput = await window.showInputBox({
        prompt: "Enter max_iterations for getSolution",
        placeHolder: "1",
        validateInput: (value) => {
          return isNaN(Number(value)) ? "Please enter a valid number" : null;
        },
      });

      if (maxIterationsInput === undefined) {
        return;
      }

      const maxIterations = Number(maxIterationsInput);

      await updateGetSolutionMaxPriority(maxPriority);
      await updateGetSolutionMaxDepth(maxDepth);
      await updateGetSolutionMaxIterations(maxIterations);

      window.showInformationMessage(
        `getSolution parameters updated: max_priority=${maxPriority}, max_depth=${maxDepth}, max_iterations=${maxIterations}`,
      );
    },
  };
};

export function registerAllCommands(state: ExtensionState) {
  let commandMap: { [command: string]: (...args: any) => any };

  // Try to create the command map
  try {
    commandMap = commandsMap(state);
  } catch (error) {
    const errorMessage = `Failed to create command map: ${error instanceof Error ? error.message : String(error)}`;
    console.error(errorMessage, error);
    window.showErrorMessage(
      `Konveyor extension failed to initialize commands. The extension cannot function properly.`,
    );
    throw new Error(errorMessage);
  }

  // Check if command map is empty (unexpected)
  const commandEntries = Object.entries(commandMap);
  if (commandEntries.length === 0) {
    const errorMessage = `Command map is empty - no commands available to register`;
    console.error(errorMessage);
    window.showErrorMessage(
      `Konveyor extension has no commands to register. The extension cannot function properly.`,
    );
    throw new Error(errorMessage);
  }

  for (const [command, callback] of commandEntries) {
    try {
      state.extensionContext.subscriptions.push(commands.registerCommand(command, callback));
    } catch (error) {
      throw new Error(`Failed to register command '${command}': ${error}`);
    }
  }
}
