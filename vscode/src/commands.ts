import AdmZip from "adm-zip";
import * as pathlib from "path";
import * as fs from "fs/promises";
import { ExtensionState } from "./extensionState";
import * as vscode from "vscode";
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
import { cleanRuleSets, loadResultsFromDataFolder, loadRuleSets, loadStaticResults } from "./data";
import { EnhancedIncident, RuleSet, Scope, ChatMessageType } from "@editor-extensions/shared";
import {
  type KaiWorkflowMessage,
  type KaiInteractiveWorkflowInput,
} from "@editor-extensions/agentic";
import {
  updateAnalyzerPath,
  getConfigAgentMode,
  getAllConfigurationValues,
  enableGenAI,
  getWorkspaceRelativePath,
  getTraceEnabled,
  getTraceDir,
  getConfigSolutionServerAuth,
  fileUriToPath,
  getConfigSolutionServer,
} from "./utilities/configuration";
import { EXTENSION_NAME } from "./utilities/constants";
import { promptForCredentials } from "./utilities/auth";
import { runPartialAnalysis } from "./analysis";
import { fixGroupOfIncidents, IncidentTypeItem } from "./issueView";
import { paths } from "./paths";
import { checkIfExecutable, copySampleProviderSettings } from "./utilities/fileUtils";
import { handleConfigureCustomRules } from "./utilities/profiles/profileActions";
import { createPatch, createTwoFilesPatch } from "diff";
import { v4 as uuidv4 } from "uuid";
import { processMessage } from "./utilities/ModifiedFiles/processMessage";
import { MessageQueueManager } from "./utilities/ModifiedFiles/queueManager";
import { VerticalDiffCodeLensProvider } from "./diff/verticalDiffCodeLens";
import type { Logger } from "winston";
import { parseModelConfig, getProviderConfigKeys } from "./modelProvider/config";

const isWindows = process.platform === "win32";

/**
 * Helper function to execute internal commands with proper extension prefix
 * Use this for all internal command executions to ensure they work with rebranding
 */
export function executeExtensionCommand(commandSuffix: string, ...args: any[]): Thenable<unknown> {
  return commands.executeCommand(`${EXTENSION_NAME}.${commandSuffix}`, ...args);
}

const commandsMap: (
  state: ExtensionState,
  logger: Logger,
) => {
  [command: string]: (...args: any) => any;
} = (state, logger) => {
  return {
    [`${EXTENSION_NAME}.openProfilesPanel`]: async () => {
      const provider = state.webviewProviders.get("profiles");
      if (provider) {
        provider.showWebviewPanel();
      } else {
        logger.error("Profiles provider not found");
      }
    },
    [`${EXTENSION_NAME}.startServer`]: async () => {
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
    [`${EXTENSION_NAME}.stopServer`]: async () => {
      const analyzerClient = state.analyzerClient;
      try {
        await analyzerClient.stop();
      } catch (e) {
        logger.error("Could not shutdown and stop the server", { error: e });
      }
    },
    [`${EXTENSION_NAME}.restartServer`]: async () => {
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
    [`${EXTENSION_NAME}.restartSolutionServer`]: async () => {
      const solutionServerClient = state.solutionServerClient;
      const config = getConfigSolutionServer();
      if (!config.enabled) {
        logger.info("Solution server is disabled, skipping restart");
        return;
      }

      try {
        window.showInformationMessage("Restarting solution server...");
        await solutionServerClient.disconnect();

        // Update state to reflect disconnected status
        state.mutateData((draft) => {
          draft.solutionServerConnected = false;
        });

        await solutionServerClient.connect();

        // Update state to reflect connected status
        state.mutateData((draft) => {
          draft.solutionServerConnected = true;
        });

        window.showInformationMessage("Solution server restarted successfully");
      } catch (e) {
        logger.error("Could not restart the solution server", { error: e });
        window.showErrorMessage(`Failed to restart solution server: ${e}`);

        // Update state to reflect failed connection
        state.mutateData((draft) => {
          draft.solutionServerConnected = false;
        });
      }
    },
    [`${EXTENSION_NAME}.runAnalysis`]: async () => {
      logger.info("Run analysis command called");
      const analyzerClient = state.analyzerClient;
      if (!analyzerClient || !analyzerClient.canAnalyze()) {
        window.showErrorMessage("Analyzer must be started and configured before run!");
        return;
      }
      analyzerClient.runAnalysis();
    },
    [`${EXTENSION_NAME}.getSolution`]: async (incidents: EnhancedIncident[]) => {
      if (state.data.isFetchingSolution) {
        logger.info("Solution already being fetched");
        window.showWarningMessage("Solution already being fetched");
        return;
      }

      // Check if GenAI is disabled
      if (state.data.configErrors.some((e) => e.type === "genai-disabled")) {
        logger.info("GenAI disabled, cannot get solution");
        window.showErrorMessage("GenAI functionality is disabled.");
        return;
      }

      // Read agent mode from configuration instead of parameter
      const agentMode = getConfigAgentMode();
      logger.info("Get solution command called", { incidents, agentMode });
      await executeExtensionCommand("showResolutionPanel");

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
        draft.chatMessages = []; // Clear previous chat messages
        draft.activeDecorators = {};
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
          if (!state.data.isWaitingForUserInteraction) {
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
            // No code changes were generated - this is normal and not necessarily an error
            logger.info("Workflow completed but no file changes were generated");
            window.showInformationMessage(
              "No code changes were suggested for the selected incidents.",
            );

            // Reset state and return early
            state.mutateData((draft) => {
              draft.solutionState = "received";
              draft.isFetchingSolution = false;
            });
            return;
          }
        }

        // Reset the cache after all processing is complete
        state.kaiFsCache.reset();

        // Update the state - solution fetching is complete
        state.mutateData((draft) => {
          draft.solutionState = "received";
          draft.isFetchingSolution = false;
          // File changes are handled through ModifiedFile messages in both agent and non-agent modes
        });

        // In non-agent mode, file changes are already handled through ModifiedFile messages
        // No need to load solution into the old diff view

        // Clean up pending interactions and resolver function after successful completion
        // Only clean up if we're not waiting for user interaction
        if (!state.data.isWaitingForUserInteraction) {
          pendingInteractions.clear();
          state.resolvePendingInteraction = undefined;

          // Reset solution state
          state.mutateData((draft) => {
            draft.solutionState = "none";
          });
        }
      } catch (error: any) {
        logger.error("Error in getSolution", { error });

        // Clean up pending interactions and resolver function on error
        // Only clean up if we're not waiting for user interaction
        if (!state.data.isWaitingForUserInteraction) {
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
    [`${EXTENSION_NAME}.getSuccessRate`]: async () => {
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
    [`${EXTENSION_NAME}.changeApplied`]: async (path: string, finalContent: string) => {
      logger.info("File change applied", { path });

      try {
        await state.solutionServerClient.acceptFile(path, finalContent);
        // After we accept a file, we should update the success rates.
        await executeExtensionCommand("getSuccessRate");
      } catch (error: any) {
        logger.error("Error notifying solution server of file acceptance", { error, path });
      }
    },
    [`${EXTENSION_NAME}.resetFetchingState`]: async () => {
      logger.warn("Manually resetting isFetchingSolution state");
      state.mutateData((draft) => {
        draft.isFetchingSolution = false;
        if (draft.solutionState === "started") {
          draft.solutionState = "failedOnSending";
        }
        draft.isWaitingForUserInteraction = false;
      });
      window.showInformationMessage("Fetching state has been reset.");
    },
    [`${EXTENSION_NAME}.changeDiscarded`]: async (path: string) => {
      logger.info("File change discarded", { path });

      try {
        await state.solutionServerClient.rejectFile(path);
        await executeExtensionCommand("getSuccessRate");
      } catch (error: any) {
        logger.error("Error notifying solution server of file rejection", { error, path });
      }
    },
    [`${EXTENSION_NAME}.askContinue`]: async (incident: EnhancedIncident) => {
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
    [`${EXTENSION_NAME}.overrideAnalyzerBinaries`]: async () => {
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
    [`${EXTENSION_NAME}.modelProviderSettingsOpen`]: async () => {
      const settingsDocument = await workspace.openTextDocument(paths().settingsYaml);
      window.showTextDocument(settingsDocument);
    },
    [`${EXTENSION_NAME}.modelProviderSettingsBackupReset`]: async () => {
      await copySampleProviderSettings(true);
      const settingsDocument = await workspace.openTextDocument(paths().settingsYaml);
      window.showTextDocument(settingsDocument);
    },
    [`${EXTENSION_NAME}.configureCustomRules`]: async (profileId: string) => {
      await handleConfigureCustomRules(profileId, state);
    },
    [`${EXTENSION_NAME}.loadRuleSets`]: async (ruleSets: RuleSet[]) =>
      loadRuleSets(state, ruleSets),
    [`${EXTENSION_NAME}.cleanRuleSets`]: () => cleanRuleSets(state),
    [`${EXTENSION_NAME}.loadStaticResults`]: loadStaticResults,
    [`${EXTENSION_NAME}.loadResultsFromDataFolder`]: loadResultsFromDataFolder,
    [`${EXTENSION_NAME}.showResolutionPanel`]: () => {
      const resolutionProvider = state.webviewProviders?.get("resolution");
      resolutionProvider?.showWebviewPanel();
    },
    [`${EXTENSION_NAME}.showAnalysisPanel`]: () => {
      const resolutionProvider = state.webviewProviders?.get("sidebar");
      resolutionProvider?.showWebviewPanel();
    },
    [`${EXTENSION_NAME}.openAnalysisDetails`]: async (item: IncidentTypeItem) => {
      //TODO: pass the item to webview and move the focus
      logger.info("Open details for item", { item });
      const resolutionProvider = state.webviewProviders?.get("sidebar");
      resolutionProvider?.showWebviewPanel();
    },
    [`${EXTENSION_NAME}.fixGroupOfIncidents`]: fixGroupOfIncidents,
    [`${EXTENSION_NAME}.fixIncident`]: fixGroupOfIncidents,
    [`${EXTENSION_NAME}.partialAnalysis`]: async (filePaths: Uri[]) =>
      runPartialAnalysis(state, filePaths),
    [`${EXTENSION_NAME}.generateDebugArchive`]: async () => {
      const archiveRawPath = await window.showInputBox({
        title: "Enter the path where the debug archive will be saved",
        value: pathlib.join(
          ".vscode",
          `konveyor-log-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`,
        ),
        ignoreFocusOut: true,
        placeHolder: "Enter the path where the debug archive will be saved",
        validateInput: async (value) => {
          if (!value) {
            return "Path is required";
          }
          if (pathlib.extname(value) !== ".zip") {
            return "Path must have a .zip extension";
          }
          return null;
        },
      });
      if (!archiveRawPath) {
        window.showErrorMessage("No path provided");
        return;
      }
      const archivePath = getWorkspaceRelativePath(archiveRawPath, state.data.workspaceRoot);
      if (!archivePath) {
        window.showErrorMessage(`Invalid path: ${archiveRawPath}`);
        return;
      }
      // redact provider config
      let redactedProviderConfig: Record<string, any> = {};
      const providerConfigPath = pathlib.join(pathlib.dirname(archivePath), `provider-config.json`);
      let providerConfigWritten = false;
      try {
        const parsedConfig = await parseModelConfig(paths().settingsYaml);
        const configuredKeys = getProviderConfigKeys(parsedConfig);
        const unredactedKeys = await window.showQuickPick(
          configuredKeys
            .map((obj) => ({
              label: obj.key,
            }))
            // all envs will be redacted no matter what
            .filter((item) => !item.label.startsWith("env.")),
          {
            title:
              "Select provider settings values you would like to include in the archive, all other values will be redacted",
            canPickMany: true,
            ignoreFocusOut: true,
          },
        );
        const unredactedKeySet = new Set((unredactedKeys || []).map((item) => item.label));
        redactedProviderConfig = configuredKeys.reduce(
          (acc, keyValue) => {
            acc[keyValue.key] = unredactedKeySet.has(keyValue.key) ? keyValue.value : "<redacted>";
            return acc;
          },
          {} as Record<string, any>,
        );
        await fs.writeFile(
          providerConfigPath,
          JSON.stringify(redactedProviderConfig, null, 2),
          "utf8",
        );
        providerConfigWritten = true;
      } catch (err) {
        window.showInformationMessage(
          `Failed to parse provider settings file. Archive will not include provider settings.`,
        );
        logger.error("Failed to parse provider settings file", { error: err });
      }
      // get extension config
      const extensionConfigPath = pathlib.join(
        pathlib.dirname(archivePath),
        `extension-config.json`,
      );
      let extensionConfigWritten = false;
      try {
        await fs.writeFile(
          extensionConfigPath,
          JSON.stringify(getAllConfigurationValues(), null, 2),
          "utf8",
        );
        extensionConfigWritten = true;
      } catch (err) {
        window.showInformationMessage(
          `Failed to get extension configuration. Archive will not include extension configuration.`,
        );
        logger.error("Failed to get extension configuration", { error: err });
      }
      // add traces dir if it exists
      const traceDir = getTraceDir(state.data.workspaceRoot);
      let traceDirFound = false;
      let includeLLMTraces: string | undefined = "No";
      try {
        if (getTraceEnabled() && traceDir) {
          const traceStat = await fs.stat(traceDir);
          if (traceStat.isDirectory()) {
            includeLLMTraces = await window.showQuickPick(["Yes", "No"], {
              title: "Include LLM traces?",
              ignoreFocusOut: true,
            });
            traceDirFound = true;
          }
        }
      } catch (err) {
        logger.error("Error getting trace directory", { error: err });
        window.showInformationMessage(
          `Failed to get trace directory. Archive will not include LLM traces.`,
        );
      }
      // add logs and write zip
      try {
        const zipArchive = new AdmZip();
        zipArchive.addLocalFolder(fileUriToPath(state.extensionContext.logUri.fsPath), "logs"); // add logs folder
        if (traceDirFound && includeLLMTraces === "Yes") {
          zipArchive.addLocalFolder(traceDir as string, "traces");
        }
        if (providerConfigWritten) {
          zipArchive.addLocalFile(providerConfigPath);
        }
        if (extensionConfigWritten) {
          zipArchive.addLocalFile(extensionConfigPath);
        }
        await fs.mkdir(pathlib.dirname(archivePath), {
          recursive: true,
        });
        await zipArchive.writeZipPromise(archivePath);
        window.showInformationMessage(`Debug archive created at: ${archivePath}`);
      } catch (error) {
        logger.error("Error generating debug archive", { error, archivePath });
        window.showErrorMessage(
          `Failed to generate debug archive: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      try {
        await fs.unlink(providerConfigPath);
        await fs.unlink(extensionConfigPath);
      } catch (error) {
        logger.error("Error cleaning up temporary files", {
          error,
          providerConfigPath,
          extensionConfigPath,
        });
      }
    },
    [`${EXTENSION_NAME}.configureSolutionServerCredentials`]: async () => {
      if (!getConfigSolutionServerAuth()) {
        logger.info("Solution server authentication is disabled.");
        window.showInformationMessage(
          "Solution server authentication is disabled. Please enable it in the extension settings.",
        );
        return;
      }

      const credentials = await promptForCredentials(state.extensionContext);
      if (!credentials) {
        logger.info("Credential configuration cancelled.");
        return;
      }

      // Update the solution server client with new credentials
      // (credentials are already stored by promptForCredentials)
      await state.solutionServerClient.authenticate(credentials.username, credentials.password);

      // Restart the connection with new credentials
      await executeExtensionCommand("restartSolutionServer");
      logger.info("Solution server credentials updated successfully.");
    },

    [`${EXTENSION_NAME}.enableGenAI`]: async () => {
      logger.info("Enabling GenAI functionality");
      try {
        await enableGenAI();
        window.showInformationMessage("GenAI functionality has been enabled.");
      } catch (error) {
        logger.error("Error enabling GenAI:", error);
        window.showErrorMessage(`Failed to enable GenAI: ${error}`);
      }
    },

    [`${EXTENSION_NAME}.showDiffWithDecorations`]: async (
      filePath: string,
      diff: string,
      content: string,
      messageToken: string,
    ) => {
      try {
        logger.debug("showDiffWithDecorations using vertical diff", { filePath, messageToken });

        // Check if vertical diff system is initialized
        if (!state.staticDiffAdapter) {
          throw new Error("Vertical diff system not initialized");
        }

        // Set activeDecorators to indicate decorators are being applied
        state.mutateData((draft) => {
          if (!draft.activeDecorators) {
            draft.activeDecorators = {};
          }
          draft.activeDecorators[messageToken] = filePath;
          logger.info(
            `[Commands] Set activeDecorators for messageToken: ${messageToken}, filePath: ${filePath}`,
          );
          logger.info(`[Commands] Current activeDecorators:`, draft.activeDecorators);
        });

        // Get original content
        const uri = Uri.file(filePath);
        const doc = await workspace.openTextDocument(uri);
        const originalContent = doc.getText();

        // Apply using Continue's system
        await state.staticDiffAdapter.applyStaticDiff(
          filePath,
          diff,
          originalContent,
          messageToken,
        );

        logger.info("Vertical diff applied successfully");
      } catch (error) {
        logger.error("Error in vertical diff:", error);

        // Clear activeDecorators on error
        state.mutateData((draft) => {
          if (draft.activeDecorators && draft.activeDecorators[messageToken]) {
            delete draft.activeDecorators[messageToken];
            logger.debug(
              `[Commands] Cleared activeDecorators on error for messageToken: ${messageToken}`,
            );
          }
        });

        vscode.window.showErrorMessage(`Failed to show diff: ${error}`);
      }
    },

    [`${EXTENSION_NAME}.acceptDiff`]: async (filePath?: string) => {
      if (!filePath) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        filePath = editor.document.fileName;
      }
      if (!state.staticDiffAdapter) {
        vscode.window.showErrorMessage("Vertical diff system not initialized");
        return;
      }
      await state.staticDiffAdapter.acceptAll(filePath);

      // Save the document after accepting changes
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.fileName === filePath) {
        await editor.document.save();
      }

      vscode.window.showInformationMessage("Changes accepted and document saved");
    },

    [`${EXTENSION_NAME}.rejectDiff`]: async (filePath?: string) => {
      if (!filePath) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        filePath = editor.document.fileName;
      }
      if (!state.staticDiffAdapter) {
        vscode.window.showErrorMessage("Vertical diff system not initialized");
        return;
      }
      await state.staticDiffAdapter.rejectAll(filePath);

      // Save the document after rejecting changes
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.fileName === filePath) {
        await editor.document.save();
      }

      vscode.window.showInformationMessage("Changes rejected and document saved");
    },

    [`${EXTENSION_NAME}.acceptVerticalDiffBlock`]: async (fileUri: string, blockIndex: number) => {
      try {
        logger.info("acceptVerticalDiffBlock called", { fileUri, blockIndex });
        const filePath = vscode.Uri.parse(fileUri).fsPath;
        if (!state.staticDiffAdapter) {
          throw new Error("Vertical diff system not initialized");
        }
        await state.staticDiffAdapter.acceptRejectBlock(filePath, blockIndex, true);
      } catch (error) {
        logger.error("Error accepting diff block:", error);
        window.showErrorMessage(`Failed to accept changes: ${error}`);
      }
    },

    [`${EXTENSION_NAME}.rejectVerticalDiffBlock`]: async (fileUri: string, blockIndex: number) => {
      try {
        logger.info("rejectVerticalDiffBlock called", { fileUri, blockIndex });
        const filePath = vscode.Uri.parse(fileUri).fsPath;
        if (!state.staticDiffAdapter) {
          throw new Error("Vertical diff system not initialized");
        }
        await state.staticDiffAdapter.acceptRejectBlock(filePath, blockIndex, false);
      } catch (error) {
        logger.error("Error rejecting diff block:", error);
        window.showErrorMessage(`Failed to reject changes: ${error}`);
      }
    },

    [`${EXTENSION_NAME}.clearDiffDecorations`]: async (filePath?: string) => {
      try {
        if (filePath) {
          const fileUri = vscode.Uri.file(filePath).toString();
          await state.verticalDiffManager?.clearForFileUri(fileUri, false);
        } else {
          // Clear all active diffs
          if (state.verticalDiffManager) {
            for (const fileUri of state.verticalDiffManager.fileUriToCodeLens.keys()) {
              await state.verticalDiffManager.clearForFileUri(fileUri, false);
            }
          }
        }
      } catch (error) {
        logger.error("Error clearing diff decorations:", error);
      }
    },

    [`${EXTENSION_NAME}.showDiffActions`]: async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      const filePath = editor.document.fileName;
      const fileUri = editor.document.uri.toString();

      if (!state.verticalDiffManager) {
        vscode.window.showInformationMessage("No active diff session");
        return;
      }

      const handler = state.verticalDiffManager.getHandlerForFile(fileUri);
      if (!handler || !handler.hasDiffForCurrentFile()) {
        vscode.window.showInformationMessage("No active diff changes in this file");
        return;
      }

      const blocks = state.verticalDiffManager.fileUriToCodeLens.get(fileUri) || [];
      const totalGreen = blocks.reduce((sum, b) => sum + b.numGreen, 0);
      const totalRed = blocks.reduce((sum, b) => sum + b.numRed, 0);

      const action = await vscode.window.showQuickPick(
        [
          {
            label: `$(check) Accept All Changes (${totalGreen}+ ${totalRed}-)`,
            description: "Accept all diff changes in this file",
            value: "accept",
          },
          {
            label: `$(x) Reject All Changes`,
            description: "Reject all diff changes in this file",
            value: "reject",
          },
        ],
        {
          placeHolder: "Choose an action for all diff changes",
        },
      );

      if (action?.value === "accept") {
        await executeExtensionCommand("acceptDiff", filePath);
      } else if (action?.value === "reject") {
        await executeExtensionCommand("rejectDiff", filePath);
      }
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

  // Create and register CodeLens provider for vertical diff blocks
  try {
    if (state.verticalDiffManager) {
      const verticalCodeLensProvider = new VerticalDiffCodeLensProvider(state.verticalDiffManager);

      state.extensionContext.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
          [{ scheme: "file" }, { scheme: "untitled" }],
          verticalCodeLensProvider,
        ),
        verticalCodeLensProvider,
      );

      // Connect refresh callback
      state.verticalDiffManager.refreshCodeLens = () => verticalCodeLensProvider.refresh();

      logger.info("Vertical diff CodeLens provider registered successfully");
    } else {
      logger.warn("Vertical diff manager not initialized, skipping CodeLens registration");
    }
  } catch (error) {
    logger.error("Failed to register vertical diff CodeLens provider:", error);
    throw new Error(`Failed to register vertical diff CodeLens provider: ${error}`);
  }
}
