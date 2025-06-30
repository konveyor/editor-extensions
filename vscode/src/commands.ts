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
  WorkspaceEdit,
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
  type KaiModifiedFile,
  type KaiWorkflowMessage,
  KaiWorkflowMessageType,
  KaiInteractiveWorkflow,
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
import {
  checkIfExecutable,
  copySampleProviderSettings,
  getBuildFilesForLanguage,
} from "./utilities/fileUtils";
import { handleConfigureCustomRules } from "./utilities/profiles/profileActions";
import { getModelConfig, ModelProvider } from "./client/modelProvider";
import { createPatch, createTwoFilesPatch } from "diff";
import { v4 as uuidv4 } from "uuid";

const isWindows = process.platform === "win32";

const commandsMap: (state: ExtensionState) => {
  [command: string]: (...args: any) => any;
} = (state) => {
  return {
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
      console.log("run analysis command called");
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
      state.mutateData((draft) => {
        draft.isFetchingSolution = true;
        draft.solutionState = "started";
        draft.solutionScope = scope;
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

        const kaiAgent = new KaiInteractiveWorkflow();
        const agentInit = kaiAgent.init({
          model: model,
          workspaceDir: state.data.workspaceRoot,
          fsCache: state.kaiFsCache,
          solutionServerClient: state.solutionServerClient,
        });

        // revert the changes back to on-disk
        // state.kaiFsCache.on("cacheInvalidated", async (path) => {
        //   // TODO (pgaikwad) - revert the changes
        //   // think about edge cases like if the document is already open by the user etc
        // });

        // TODO (pgaikwad) - revisit this
        // this is a number I am setting for demo purposes
        // until we have a full UI support. we will only
        // process child issues until the depth of 1
        const maxTaskManagerIterations = 1;
        let currentTaskManagerIterations = 0;

        // Process each file's incidents
        const allDiffs: { original: string; modified: string; diff: string }[] = [];
        const modifiedFiles: Map<string, modifiedFileState> = new Map<string, modifiedFileState>();
        const modifiedFilesPromises: Array<Promise<void>> = [];
        let lastMessageId: string = "0";
        // listen on agents events
        kaiAgent.on("workflowMessage", async (msg: KaiWorkflowMessage) => {
          switch (msg.type) {
            case KaiWorkflowMessageType.UserInteraction: {
              switch (msg.data.type) {
                // waiting on user for confirmation
                case "yesNo":
                  state.mutateData((draft) => {
                    draft.chatMessages.push({
                      kind: ChatMessageType.String,
                      messageToken: msg.id,
                      timestamp: new Date().toISOString(),
                      value: {
                        message: msg.data.systemMessage.yesNo,
                      },
                    });
                  });
                  msg.data.response = {
                    // respond with "yes" when agent mode is enabled
                    yesNo: getConfigAgentMode(),
                  };
                  kaiAgent.resolveUserInteraction(msg);
                  break;
                // waiting on ide to provide more tasks
                case "tasks": {
                  if (currentTaskManagerIterations < maxTaskManagerIterations) {
                    currentTaskManagerIterations += 1;
                    await new Promise<void>((resolve) => {
                      const interval = setInterval(() => {
                        if (!state.data.isAnalysisScheduled && !state.data.isAnalyzing) {
                          clearInterval(interval);
                          resolve();
                          return;
                        }
                      }, 1000);
                    });
                    const tasks = state.taskManager.getTasks().map((t) => {
                      return {
                        uri: t.getUri().fsPath,
                        task:
                          t.toString().length > 100
                            ? t.toString().slice(0, 100).replaceAll("`", "'").replaceAll(">", "") +
                              "..."
                            : t.toString(),
                      } as { uri: string; task: string };
                    });
                    if (tasks.length > 0) {
                      state.mutateData((draft) => {
                        draft.chatMessages.push({
                          kind: ChatMessageType.String,
                          messageToken: msg.id,
                          timestamp: new Date().toISOString(),
                          value: {
                            message: `It appears that my fixes caused following issues:\n\n - \
                              ${[...new Set(tasks.map((t) => t.task))].join("\n * ")}\n\nDo you want me to continue fixing them?`,
                          },
                        });
                      });
                      msg.data.response = { tasks, yesNo: true };
                      kaiAgent.resolveUserInteraction(msg);
                    } else {
                      msg.data.response = {
                        yesNo: false,
                      };
                      kaiAgent.resolveUserInteraction(msg);
                    }
                  } else {
                    msg.data.response = {
                      yesNo: false,
                    };
                    kaiAgent.resolveUserInteraction(msg);
                  }
                }
              }
              break;
            }
            case KaiWorkflowMessageType.LLMResponseChunk: {
              const chunk = msg.data;
              const content =
                typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);

              if (msg.id !== lastMessageId) {
                state.mutateData((draft) => {
                  draft.chatMessages.push({
                    kind: ChatMessageType.String,
                    messageToken: msg.id,
                    timestamp: new Date().toISOString(),
                    value: {
                      message: content,
                    },
                  });
                });
                lastMessageId = msg.id;
              } else {
                state.mutateData((draft) => {
                  draft.chatMessages[draft.chatMessages.length - 1].value.message += content;
                });
              }
              break;
            }
            case KaiWorkflowMessageType.ModifiedFile: {
              modifiedFilesPromises.push(processModifiedFile(modifiedFiles, msg.data));
              break;
            }
          }
        });

        try {
          await agentInit;
          await kaiAgent.run({
            incidents,
            migrationHint: profileName,
            programmingLanguage: "Java",
            enableAdditionalInformation: getConfigAgentMode(),
            enableDiagnostics: getConfigSuperAgentMode(),
          } as KaiInteractiveWorkflowInput);
        } catch (err) {
          console.error(`Error in running the agent - ${err}`);
          console.info(`Error trace - `, err instanceof Error ? err.stack : "N/A");
          window.showErrorMessage(
            `We encountered an error running the agent - ${err instanceof Error ? err.message || String(err) : String(err)}`,
          );
        }

        // wait for modified files to process
        await Promise.all(modifiedFilesPromises);

        // process diffs from agent workflow & undo any edits we made
        await Promise.all(
          Array.from(modifiedFiles.entries()).map(async ([path, state]) => {
            const { originalContent, modifiedContent } = state;
            const uri = Uri.file(path);
            const relativePath = workspace.asRelativePath(uri);
            try {
              // revert the edit
              // TODO(pgaikwad) - use ws edit api
              await workspace.fs.writeFile(uri, new Uint8Array(Buffer.from(originalContent ?? "")));
            } catch (err) {
              console.error(`Error reverting edits - ${err}`);
            }
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

        // now that all agents have returned, we can reset the cache
        state.kaiFsCache.reset();
        kaiAgent.removeAllListeners();

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

        // Update the state with the solution and reasoning
        state.mutateData((draft) => {
          draft.solutionState = "received";
          draft.isFetchingSolution = false;
          draft.solutionData = solutionResponse;

          draft.chatMessages.push({
            messageToken: `m${Date.now()}`,
            kind: ChatMessageType.String,
            value: { message: "Solution generated successfully!" },
            timestamp: new Date().toISOString(),
          });
        });

        // Load the solution
        commands.executeCommand("konveyor.loadSolution", solutionResponse, { incidents });
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

interface modifiedFileState {
  // if a file is newly created, original content can be undefined
  originalContent: string | undefined;
  modifiedContent: string;
  editType: "inMemory" | "toDisk";
}

// processes a ModifiedFile message from agents
// 1. stores the state of the edit in a map to be reverted later
// 2. dependending on type of the file being modified:
//    a. For a build file, applies the edit directly to disk
//    b. For a non-build file, applies the edit to the file in-memory
async function processModifiedFile(
  modifiedFilesState: Map<string, modifiedFileState>,
  modifiedFile: KaiModifiedFile,
): Promise<void> {
  const { path, content } = modifiedFile;
  const uri = Uri.file(path);
  const editType = getBuildFilesForLanguage("java").some((f) => uri.fsPath.endsWith(f))
    ? "toDisk"
    : "inMemory";
  const alreadyModified = modifiedFilesState.has(uri.fsPath);
  // check if this is a newly created file
  let isNew = false;
  let originalContent: undefined | string = undefined;
  if (!alreadyModified) {
    try {
      await workspace.fs.stat(uri);
    } catch (err) {
      if ((err as any).code === "FileNotFound" || (err as any).name === "EntryNotFound") {
        isNew = true;
      } else {
        throw err;
      }
    }
    originalContent = isNew
      ? undefined
      : new TextDecoder().decode(await workspace.fs.readFile(uri));
    modifiedFilesState.set(uri.fsPath, {
      modifiedContent: content,
      originalContent,
      editType,
    });
  } else {
    modifiedFilesState.set(uri.fsPath, {
      ...(modifiedFilesState.get(uri.fsPath) as modifiedFileState),
      modifiedContent: content,
    });
  }
  // if we are not running full agentic flow, we don't have to persist changes
  if (!getConfigSuperAgentMode()) {
    return;
  }
  if (editType === "toDisk") {
    await workspace.fs.writeFile(uri, new Uint8Array(Buffer.from(content)));
  } else {
    try {
      if (isNew && !alreadyModified) {
        await workspace.fs.writeFile(uri, new Uint8Array(Buffer.from("")));
      }
      // an in-memory edit is applied via the editor window
      const textDocument = await workspace.openTextDocument(uri);
      const range = new Range(
        textDocument.positionAt(0),
        textDocument.positionAt(textDocument.getText().length),
      );
      const edit = new WorkspaceEdit();
      edit.replace(uri, range, content);
      await workspace.applyEdit(edit);
    } catch (err) {
      console.log(`Failed to apply edit made by the agent - ${String(err)}`);
    }
  }
}
