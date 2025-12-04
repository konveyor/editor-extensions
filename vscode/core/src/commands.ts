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
import { EnhancedIncident, RuleSet } from "@editor-extensions/shared";
import {
  updateAnalyzerPath,
  getAllConfigurationValues,
  enableGenAI,
  getWorkspaceRelativePath,
  getTraceEnabled,
  getTraceDir,
  fileUriToPath,
} from "./utilities/configuration";
import { EXTENSION_NAME } from "./utilities/constants";
import { runPartialAnalysis } from "./analysis";
import { fixGroupOfIncidents, IncidentTypeItem } from "./issueView";
import { paths } from "./paths";
import { checkIfExecutable, copySampleProviderSettings } from "./utilities/fileUtils";
import { handleConfigureCustomRules } from "./utilities/profiles/profileActions";
import { VerticalDiffCodeLensProvider } from "./diff/verticalDiffCodeLens";
import type { Logger } from "winston";
import { parseModelConfig, getProviderConfigKeys } from "./modelProvider/config";
import { SolutionWorkflowOrchestrator } from "./solutionWorkflowOrchestrator";

const isWindows = process.platform === "win32";

/**
 * Helper function to execute internal commands with proper extension prefix
 * Use this for all internal command executions to ensure they work with rebranding
 */
export function executeExtensionCommand(commandSuffix: string, ...args: any[]): Thenable<unknown> {
  return commands.executeCommand(`${EXTENSION_NAME}.${commandSuffix}`, ...args);
}

/**
 * Check if any language providers are registered before starting analyzer
 * @returns true if providers are registered, false if not (and shows warning)
 */
function checkProvidersRegistered(state: ExtensionState, logger: Logger): boolean {
  const providers = state.analyzerClient.getRegisteredProviders();
  if (providers.length === 0) {
    const message =
      "No language providers are registered yet. Please wait for language extensions " +
      "(e.g., Konveyor Java) to finish loading before starting the analyzer.";
    logger.warn(message);
    vscode.window.showWarningMessage(message);
    return false;
  }
  return true;
}

/**
 * Helper function to execute deferred workflow disposal after solution completes
 */
export function executeDeferredWorkflowDisposal(state: ExtensionState, logger: Logger): void {
  if (state.workflowDisposalPending && state.workflowManager && state.workflowManager.dispose) {
    logger.info("Executing deferred workflow disposal after solution completion");
    state.workflowManager.dispose();
    state.workflowDisposalPending = false;
  }
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
    [`${EXTENSION_NAME}.openHubSettingsPanel`]: async () => {
      const provider = state.webviewProviders.get("hub");
      if (provider) {
        provider.showWebviewPanel();
      } else {
        logger.error("Hub settings provider not found");
      }
    },
    [`${EXTENSION_NAME}.startServer`]: async () => {
      const analyzerClient = state.analyzerClient;

      if (!checkProvidersRegistered(state, logger)) {
        return;
      }

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

        if (!checkProvidersRegistered(state, logger)) {
          return;
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
      const config = state.data.hubConfig;
      if (!config?.enabled) {
        logger.info("Solution server is disabled, skipping restart");
        return;
      }

      try {
        window.showInformationMessage("Restarting solution server...");
        await solutionServerClient.disconnect();

        // Update state to reflect disconnected status
        state.mutateServerState((draft) => {
          draft.solutionServerConnected = false;
        });

        await solutionServerClient.connect();

        // Update state to reflect connected status
        state.mutateServerState((draft) => {
          draft.solutionServerConnected = true;
        });

        window.showInformationMessage("Solution server restarted successfully");
      } catch (e) {
        logger.error("Could not restart the solution server", { error: e });
        window.showErrorMessage(`Failed to restart solution server: ${e}`);

        // Update state to reflect failed connection
        state.mutateServerState((draft) => {
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

      // Check if analysis is already running
      if (state.data.isAnalyzing) {
        window.showWarningMessage("Analysis is already running. Please wait for it to complete.");
        return;
      }

      // Check if scheduled analysis is actively running
      if (state.batchedAnalysisTrigger?.isScheduledAnalysisRunning()) {
        window.showWarningMessage(
          "Analysis is already starting. Please wait a moment and try again.",
        );
        return;
      }

      // Cancel any scheduled analysis before running manual analysis
      if (state.data.isAnalysisScheduled && state.batchedAnalysisTrigger) {
        logger.info("Cancelling scheduled analysis in favor of manual analysis");
        state.batchedAnalysisTrigger.cancelScheduledAnalysis();
      }

      analyzerClient.runAnalysis();
    },
    [`${EXTENSION_NAME}.getSolution`]: async (incidents: EnhancedIncident[]) => {
      const orchestrator = new SolutionWorkflowOrchestrator(state, logger, incidents);
      await orchestrator.run();
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
        state.mutateAnalysisState((draft) => {
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
      state.mutateSolutionWorkflow((draft) => {
        draft.isFetchingSolution = false;
        if (draft.solutionState === "started") {
          draft.solutionState = "failedOnSending";
        }
        draft.isWaitingForUserInteraction = false;
      });
      executeDeferredWorkflowDisposal(state, logger);
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
      // Credentials are now configured through the Hub Settings form
      window.showInformationMessage(
        "Please configure Hub credentials through the Hub Configuration panel.",
      );
      executeExtensionCommand("openHubSettingsPanel");
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
        state.mutateDecorators((draft) => {
          if (!draft.activeDecorators) {
            draft.activeDecorators = {};
          }
          draft.activeDecorators[messageToken] = filePath;
        });
        logger.info(
          `[Commands] Set activeDecorators for messageToken: ${messageToken}, filePath: ${filePath}`,
        );

        // Get original content
        const uri = Uri.file(filePath);
        let originalContent = "";

        try {
          const doc = await workspace.openTextDocument(uri);
          originalContent = doc.getText();
        } catch {
          // File might not exist yet (new file), use empty content
          logger.debug(`File not found, treating as new file: ${filePath}`);
          originalContent = "";
        }

        // Check if diff is for a new file (no original content)
        const isNewFile =
          originalContent === "" &&
          !(await workspace.fs.stat(uri).then(
            () => true,
            () => false,
          ));
        if (isNewFile) {
          logger.info(`Skipping decorator view for new file: ${filePath}`);
          // For new files, we can't show decorators since there's no file to decorate
          // Just clear the activeDecorators to indicate completion
          state.mutateDecorators((draft) => {
            if (draft.activeDecorators) {
              delete draft.activeDecorators[messageToken];
            }
          });
          return;
        }

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
        state.mutateDecorators((draft) => {
          if (draft.activeDecorators) {
            delete draft.activeDecorators[messageToken];
          }
        });
        logger.debug(
          `[Commands] Cleared activeDecorators on error for messageToken: ${messageToken}`,
        );

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
