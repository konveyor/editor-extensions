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
} from "./utilities/configuration";
import { runPartialAnalysis } from "./analysis";
import { fixGroupOfIncidents, IncidentTypeItem } from "./issueView";
import { paths } from "./paths";
import { checkIfExecutable, copySampleProviderSettings } from "./utilities/fileUtils";
import { handleConfigureCustomRules } from "./utilities/profiles/profileActions";
import { createPatch, createTwoFilesPatch } from "diff";
import { v4 as uuidv4 } from "uuid";
import { processMessage } from "./utilities/ModifiedFiles/processMessage";
import { MessageQueueManager } from "./utilities/ModifiedFiles/queueManager";
import type { Logger } from "winston";

const isWindows = process.platform === "win32";

const commandsMap: (
  state: ExtensionState,
  logger: Logger,
) => {
  [command: string]: (...args: any) => any;
} = (state, logger) => {
  return {
    "konveyor.openProfilesPanel": async () => {
      const provider = state.webviewProviders.get("profiles");
      if (provider) {
        provider.showWebviewPanel();
      } else {
        logger.error("Profiles provider not found");
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
        logger.error("Could not start the server", { error: e });
      }
    },
    "konveyor.stopServer": async () => {
      const analyzerClient = state.analyzerClient;
      try {
        await analyzerClient.stop();
      } catch (e) {
        logger.error("Could not shutdown and stop the server", { error: e });
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
        logger.error("Could not restart the server", { error: e });
      }
    },
    "konveyor.restartSolutionServer": async () => {
      const solutionServerClient = state.solutionServerClient;
      try {
        window.showInformationMessage("Restarting solution server...");
        await solutionServerClient.disconnect();
        await solutionServerClient.connect();
        window.showInformationMessage("Solution server restarted successfully");
      } catch (e) {
        logger.error("Could not restart the solution server", { error: e });
        window.showErrorMessage(`Failed to restart solution server: ${e}`);
      }
    },
    "konveyor.runAnalysis": async () => {
      logger.info("Run analysis command called");
      const analyzerClient = state.analyzerClient;
      if (!analyzerClient || !analyzerClient.canAnalyze()) {
        window.showErrorMessage("Analyzer must be started and configured before run!");
        return;
      }
      analyzerClient.runAnalysis();
    },
    "konveyor.getSolution": async (incidents: EnhancedIncident[]) => {
      // Read agent mode from configuration instead of parameter
      const agentMode = getConfigAgentMode();
      logger.info("Get solution command called", { incidents, agentMode });
      await commands.executeCommand("konveyor.showResolutionPanel");

      // Create a scope for the solution
      const scope: Scope = { incidents };

      const clientId = uuidv4();
      state.solutionServerClient.setClientId(clientId);
      logger.debug("Client ID set", { clientId });

      // Update the state to indicate we're starting to fetch a solution
      // Clear previous data to prevent stale content from showing
      state.mutateData((draft) => {
        draft.isFetchingSolution = true;
        draft.solutionState = "started";
        draft.solutionScope = scope;
        draft.chatMessages = []; // Clear previous chat messages (agentic mode)
        draft.localChanges = []; // Clear previous local changes (non-agentic mode)
        draft.solutionData = undefined; // Clear previous solution data
      });

      // Declare variables outside try block for proper cleanup access
      const pendingInteractions = new Map<string, (response: any) => void>();
      let workflow: any;

      try {
        // Get the model provider configuration from settings YAML
        if (!state.modelProvider) {
          throw new Error(
            "Chat model is not initialized. Please check your model provider settings.",
          );
        }

        // Get the profile name from the incidents
        const profileName = incidents[0]?.activeProfileName;
        if (!profileName) {
          window.showErrorMessage("No profile name found in incidents");
          return;
        }

        // Create array to store all diffs
        const allDiffs: { original: string; modified: string; diff: string }[] = [];

        // Set the state to indicate we're fetching a solution

        await state.workflowManager.init({
          modelProvider: state.modelProvider,
          workspaceDir: state.data.workspaceRoot,
          solutionServerClient: state.solutionServerClient,
        });
        logger.debug("Agent initialized");

        // Get the workflow instance
        workflow = state.workflowManager.getWorkflow();
        // Track processed message tokens to prevent duplicates
        const processedTokens = new Set<string>();

        // Clear any existing modified files state at the start of a new solution
        state.modifiedFiles.clear();
        const modifiedFilesPromises: Array<Promise<void>> = [];
        // Queue to store messages that arrive while waiting for user interaction

        // Create the queue manager for centralized queue processing
        const queueManager = new MessageQueueManager(
          state,
          workflow,
          modifiedFilesPromises,
          processedTokens,
          pendingInteractions,
        );

        // Store the resolver function in the state so webview handler can access it
        state.resolvePendingInteraction = (messageId: string, response: any) => {
          const resolver = pendingInteractions.get(messageId);
          if (resolver) {
            try {
              pendingInteractions.delete(messageId);
              resolver(response);
              return true;
            } catch (error) {
              logger.error(`Error executing resolver for messageId: ${messageId}:`, error);
              return false;
            }
          } else {
            return false;
          }
        };

        // Set up the event listener to use our message processing function

        workflow.removeAllListeners();
        workflow.on("workflowMessage", async (msg: KaiWorkflowMessage) => {
          logger.info(`Workflow message received: ${msg.type} (${msg.id})`);
          await processMessage(msg, state, queueManager);
        });

        // Add error event listener to catch workflow errors
        workflow.on("error", (error: any) => {
          logger.error("Workflow error:", error);
          state.mutateData((draft) => {
            draft.isFetchingSolution = false;
            if (draft.solutionState === "started") {
              draft.solutionState = "failedOnSending";
            }
          });
        });

        try {
          const input: KaiInteractiveWorkflowInput = {
            incidents,
            migrationHint: profileName,
            programmingLanguage: "Java",
            enableAgentMode: agentMode,
          };

          await workflow.run(input);

          // Wait for all message processing to complete before proceeding
          // This is critical for non-agentic mode where ModifiedFile messages
          // are processed asynchronously during the workflow
          if (!agentMode) {
            // Give a short delay to ensure all async message processing completes
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Wait for any remaining promises in the modifiedFilesPromises array
            await Promise.all(modifiedFilesPromises);
          }
        } catch (err) {
          logger.error(`Error in running the agent - ${err}`);
          logger.info(`Error trace - `, err instanceof Error ? err.stack : "N/A");

          // Ensure isFetchingSolution is reset on any error
          state.mutateData((draft) => {
            draft.isFetchingSolution = false;
            if (draft.solutionState === "started") {
              draft.solutionState = "failedOnSending";
            }
          });
        } finally {
          // Clear the stuck interaction monitoring

          // Ensure isFetchingSolution is reset even if workflow fails unexpectedly
          state.mutateData((draft) => {
            draft.isFetchingSolution = false;
            if (draft.solutionState === "started") {
              draft.solutionState = "failedOnSending";
            }
            // Also ensure analysis flags are reset to prevent stuck tasks interactions
            draft.isAnalyzing = false;
            draft.isAnalysisScheduled = false;
          });

          // Clean up queue manager
          if (queueManager) {
            queueManager.dispose();
          }

          // Only clean up if we're not waiting for user interaction
          // This prevents clearing pending interactions while users are still deciding on file changes
          if (!state.isWaitingForUserInteraction) {
            pendingInteractions.clear();
            state.resolvePendingInteraction = undefined;
          }

          // Clean up workflow resources
          if (workflow) {
            workflow.removeAllListeners();
          }

          // Dispose of workflow manager if it has pending resources
          if (state.workflowManager && state.workflowManager.dispose) {
            state.workflowManager.dispose();
          }
        }

        // In agentic mode, file changes are handled through ModifiedFile messages
        // In non-agentic mode, we need to process diffs from modified files
        if (!agentMode) {
          // Wait for all file processing to complete
          await Promise.all(modifiedFilesPromises);

          // Event-driven approach - wait for modifiedFiles to be populated
          // This handles cases where message processing might still be ongoing
          if (state.modifiedFiles.size === 0) {
            await new Promise<void>((resolve) => {
              const timeout = setTimeout(() => {
                resolve();
              }, 5000); // 5 seconds max timeout

              const onFileAdded = () => {
                clearTimeout(timeout);
                state.modifiedFilesEventEmitter.removeListener("modifiedFileAdded", onFileAdded);
                resolve();
              };

              state.modifiedFilesEventEmitter.once("modifiedFileAdded", onFileAdded);
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
                  const diff = createTwoFilesPatch("", relativePath, "", modifiedContent);
                  allDiffs.push({
                    diff,
                    modified: relativePath,
                    original: "",
                  });
                } else {
                  const diff = createPatch(relativePath, originalContent, modifiedContent);
                  allDiffs.push({
                    diff,
                    modified: relativePath,
                    original: relativePath,
                  });
                }
              } catch (err) {
                logger.error(`Error in processing diff for ${relativePath} - ${err}`);
              }
            }),
          );

          if (allDiffs.length === 0) {
            throw new Error("No diffs found in the response");
          }
        }

        // Reset the cache after all processing is complete
        state.kaiFsCache.reset();

        // Create a solution response with properly structured changes
        const solutionResponse: GetSolutionResult = {
          changes: allDiffs,
          encountered_errors: [],
          scope: { incidents },
          clientId: clientId,
        };

        // Update the state with the solution
        state.mutateData((draft) => {
          draft.solutionState = "received";
          draft.isFetchingSolution = false;

          // Only set solutionData in non-agentic mode where we have traditional diffs
          if (!agentMode) {
            draft.solutionData = solutionResponse;
            // Note: Removed redundant "Solution generated successfully!" message
            // The specific completion status messages (e.g. "All resolutions have been applied")
            // provide more meaningful feedback to users
          }
          // In agentic mode, file changes are handled through ModifiedFile messages in chat
        });

        // Load the solution
        if (!agentMode) {
          commands.executeCommand("konveyor.loadSolution", solutionResponse, { incidents });
        }

        // Clean up pending interactions and resolver function after successful completion
        // Only clean up if we're not waiting for user interaction
        if (!state.isWaitingForUserInteraction) {
          pendingInteractions.clear();
          state.resolvePendingInteraction = undefined;
        }
      } catch (error: any) {
        logger.error("Error in getSolution", { error });

        // Clean up pending interactions and resolver function on error
        // Only clean up if we're not waiting for user interaction
        if (!state.isWaitingForUserInteraction) {
          pendingInteractions.clear();
          state.resolvePendingInteraction = undefined;
        }

        // Update the state to indicate an error
        state.mutateData((draft) => {
          draft.solutionState = "failedOnSending";
          draft.isFetchingSolution = false;
          draft.chatMessages.push({
            messageToken: `m${Date.now()}`,
            kind: ChatMessageType.String,
            value: { message: `Error: ${error instanceof Error ? error.message : String(error)}` },
            timestamp: new Date().toISOString(),
          });
        });

        window.showErrorMessage(
          `Failed to generate solution: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    "konveyor.getSuccessRate": async () => {
      logger.info("Getting success rate for incidents");

      try {
        if (!state.data.enhancedIncidents || state.data.enhancedIncidents.length === 0) {
          logger.info("No incidents to update");
          return;
        }

        const currentIncidents = state.data.enhancedIncidents.map((incident) => ({
          ...incident,
          violation_labels: incident.violation_labels ? [...incident.violation_labels] : undefined,
        }));
        const updatedIncidents = await state.solutionServerClient.getSuccessRate(currentIncidents);

        // Update the state with the enhanced incidents
        state.mutateData((draft) => {
          draft.enhancedIncidents = updatedIncidents;
        });
      } catch (error: any) {
        logger.error("Error getting success rate", { error });
      }
    },
    "konveyor.changeApplied": async (clientId: string, path: string, finalContent: string) => {
      logger.info("File change applied", { path });

      try {
        await state.solutionServerClient.acceptFile(clientId, path, finalContent);
      } catch (error: any) {
        logger.error("Error notifying solution server of file acceptance", { error, path });
      }
    },
    "konveyor.resetFetchingState": async () => {
      logger.warn("Manually resetting isFetchingSolution state");
      state.mutateData((draft) => {
        draft.isFetchingSolution = false;
        if (draft.solutionState === "started") {
          draft.solutionState = "failedOnSending";
        }
      });
      state.isWaitingForUserInteraction = false;
      window.showInformationMessage("Fetching state has been reset.");
    },
    "konveyor.changeDiscarded": async (clientId: string, path: string) => {
      logger.info("File change discarded", { path });

      try {
        await state.solutionServerClient.rejectFile(clientId, path);
      } catch (error: any) {
        logger.error("Error notifying solution server of file rejection", { error, path });
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
        logger.error("Failed to open document", { error, uri: incident.uri });
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
      logger.info("Open details for item", { item });
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
  // Create a child logger for commands
  const logger = state.logger.child({ component: "vscode.commands" });

  let commandMap: { [command: string]: (...args: any) => any };

  // Try to create the command map
  try {
    commandMap = commandsMap(state, logger);
  } catch (error) {
    const errorMessage = `Failed to create command map: ${error instanceof Error ? error.message : String(error)}`;
    logger.error(errorMessage, { error });
    window.showErrorMessage(
      `Konveyor extension failed to initialize commands. The extension cannot function properly.`,
    );
    throw new Error(errorMessage);
  }

  // Check if command map is empty (unexpected)
  const commandEntries = Object.entries(commandMap);
  if (commandEntries.length === 0) {
    const errorMessage = `Command map is empty - no commands available to register`;
    logger.error(errorMessage);
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
