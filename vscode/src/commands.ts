import { ExtensionState, ModifiedFileState } from "./extensionState";
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
import type { ToolMessageValue } from "@editor-extensions/shared";
import {
  type KaiModifiedFile,
  type KaiWorkflowMessage,
  KaiWorkflowMessageType,
  type KaiInteractiveWorkflowInput,
  type KaiUserIteraction,
} from "@editor-extensions/agentic";
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
import { ChatOpenAI, AzureChatOpenAI } from "@langchain/openai";
import { ChatBedrockConverse, type ChatBedrockConverseInput } from "@langchain/aws";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatOllama } from "@langchain/ollama";
import { getModelProvider } from "./client/modelProvider";
import { createPatch, createTwoFilesPatch } from "diff";

const isWindows = process.platform === "win32";

// processes a ModifiedFile message from agents
// 1. stores the state of the edit in a map to be reverted later
// 2. dependending on type of the file being modified:
//    a. For a build file, applies the edit directly to disk
//    b. For a non-build file, applies the edit to the file in-memory
async function processModifiedFile(
  modifiedFilesState: Map<string, ModifiedFileState>,
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
      ...(modifiedFilesState.get(uri.fsPath) as ModifiedFileState),
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

const commandsMap: (state: ExtensionState) => {
  [command: string]: (...args: any) => any;
} = (state) => {
  return {
    "konveyor.notifyFileAction": async (payload: {
      path: string;
      action: string;
      messageToken?: string;
    }) => {
      try {
        // Find the message in the chat messages, first by messageToken if provided
        let messageIndex = -1;
        if (payload.messageToken) {
          messageIndex = state.data.chatMessages.findIndex(
            (msg) =>
              msg.kind === ChatMessageType.ModifiedFile &&
              (msg.value as any).path === payload.path &&
              msg.messageToken === payload.messageToken,
          );

          if (messageIndex === -1) {
            console.log(
              `No message found for path: ${payload.path} and token: ${payload.messageToken}`,
            );
          } else {
            console.log(
              `Found message for path: ${payload.path} with token: ${payload.messageToken} at index: ${messageIndex}`,
            );
          }
        }

        // If no message found by token, try to find by path
        if (messageIndex === -1) {
          messageIndex = state.data.chatMessages.findIndex(
            (msg) =>
              msg.kind === ChatMessageType.ModifiedFile &&
              (msg.value as any).path === payload.path &&
              !(msg.value as any).status, // Only match messages without a status (pending)
          );

          if (messageIndex !== -1) {
            console.log(
              `Found pending message for path: ${payload.path} at index: ${messageIndex} by path matching`,
            );
          } else {
            console.log(`No pending message found for path: ${payload.path} by path matching`);
          }
        }

        // Update the UI state to reflect the action
        state.mutateData((draft) => {
          // Add a message indicating the action taken
          draft.chatMessages.push({
            kind: ChatMessageType.String,
            messageToken: `action-${Date.now()}`,
            timestamp: new Date().toISOString(),
            value: {
              message:
                payload.action === "applied"
                  ? `Changes to ${payload.path} were applied from the editor.`
                  : `Changes to ${payload.path} were rejected from the editor.`,
            },
          });

          // Update the status of the modified file message if found
          if (messageIndex !== -1) {
            const msg = draft.chatMessages[messageIndex];
            if (msg.kind === ChatMessageType.ModifiedFile) {
              (msg.value as any).status = payload.action;
            }
          }

          // Check for pending file modifications and queued messages to update UI status
          // const hasPendingFileModifications = Array.from(state.modifiedFiles.values()).some(
          //   (file) => file.editType === "inMemory" && file.modifiedContent !== file.originalContent,
          // );
          // const hasMoreQueuedMessages = false; // Placeholder, actual queue status should be checked if accessible

          // Adjust the message based on the action taken; assume applying a change might clear pending status if it was the last one.
          // draft.chatMessages.push({
          //   kind: ChatMessageType.String,
          //   messageToken: `queue-status-${Date.now()}`,
          //   timestamp: new Date().toISOString(),
          //   value: {
          //     message:
          //       payload.action === "applied" && !hasPendingFileModifications && !hasMoreQueuedMessages
          //         ? "✅ All changes have been processed. You're up to date!"
          //         : "There are more changes to review.",
          //   },
          //   quickResponses:
          //     payload.action === "applied" && !hasPendingFileModifications && !hasMoreQueuedMessages
          //       ? [
          //           { id: "run-analysis", content: "Run Analysis" },
          //           { id: "return-analysis", content: "Return to Analysis Page" },
          //         ]
          //       : undefined,
          // });
        });

        // Resolve any pending interaction if messageToken is provided or found by path
        if (messageIndex !== -1 && state.resolvePendingInteraction) {
          const msg = state.data.chatMessages[messageIndex];
          if (msg && msg.messageToken) {
            const resolved = state.resolvePendingInteraction(msg.messageToken, {
              action: payload.action,
            });
            if (resolved) {
              console.log(
                `Resolved pending interaction for message token: ${msg.messageToken} with action: ${payload.action}`,
              );
            } else {
              console.log(`No pending interaction found for message token: ${msg.messageToken}`);
            }
          }
        }

        // If the action was 'applied', we need to update the file
        if (payload.action === "applied" && messageIndex !== -1) {
          // const msg = state.data.chatMessages[messageIndex];
          // const content = (msg.value as any).content;
          // if (content) {
          //   const uri = vscode.Uri.file(payload.path);
          //   await vscode.workspace.fs.writeFile(uri, new Uint8Array(Buffer.from(content)));
          //   vscode.window.showInformationMessage(
          //     `Changes applied to ${vscode.workspace.asRelativePath(uri)}`,
          //   );
          // }
        }
      } catch (error) {
        console.error("Error handling FILE_ACTION:", error);
        vscode.window.showErrorMessage(`Failed to process file action: ${error}`);
      }
    },
    "konveyor.notifyWebviewOfFileAction": async (payload: {
      path: string;
      messageToken: string;
      action: "applied" | "rejected";
    }) => {
      // Redirect to the consolidated notifyFileAction command
      await commands.executeCommand("konveyor.notifyFileAction", payload);
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
        const modelProvider = await getModelProvider(paths().settingsYaml);
        if (!modelProvider) {
          throw new Error("Model provider configuration not found in settings YAML.");
        }

        // Initialize the appropriate model based on the provider
        let model;
        const providerType = modelProvider.modelProvider.provider;

        switch (providerType) {
          case "ChatOpenAI":
            model = new ChatOpenAI({
              openAIApiKey: modelProvider.env.OPENAI_API_KEY,
              modelName: modelProvider.modelProvider.args["model"],
              streaming: true,
              temperature: modelProvider.modelProvider.args["temperature"] || 0.1,
              maxTokens: modelProvider.modelProvider.args["max_tokens"],
            });
            break;

          case "AzureChatOpenAI":
            model = new AzureChatOpenAI({
              openAIApiKey: modelProvider.env.OPENAI_API_KEY,
              deploymentName: modelProvider.modelProvider.args["azure_deployment"],
              openAIApiVersion: modelProvider.modelProvider.args["api_version"],
              streaming: true,
              temperature: modelProvider.modelProvider.args["temperature"] || 0.1,
              maxTokens: modelProvider.modelProvider.args["max_tokens"],
            });
            break;

          case "ChatBedrock": {
            const config: ChatBedrockConverseInput = {
              model: modelProvider.modelProvider.args["model_id"],
              region: modelProvider.env.AWS_DEFAULT_REGION,
              streaming: true,
              temperature: modelProvider.modelProvider.args["temperature"],
              maxTokens: modelProvider.modelProvider.args["max_tokens"],
            };
            // aws credentials can be specified globally using a credentials file
            if (modelProvider.env.AWS_ACCESS_KEY_ID && modelProvider.env.AWS_SECRET_ACCESS_KEY) {
              config.credentials = {
                accessKeyId: modelProvider.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: modelProvider.env.AWS_SECRET_ACCESS_KEY,
              };
            }
            model = new ChatBedrockConverse(config);
            break;
          }
          case "ChatGoogleGenerativeAI":
            model = new ChatGoogleGenerativeAI({
              model: modelProvider.modelProvider.args["model_id"],
              streaming: true,
              temperature: modelProvider.modelProvider.args["temperature"] || 0.7,
              maxOutputTokens: modelProvider.modelProvider.args["max_tokens"],
            });
            break;

          case "ChatDeepSeek":
            model = new ChatDeepSeek({
              modelName: modelProvider.modelProvider.args["model"],
              streaming: true,
              temperature: modelProvider.modelProvider.args["temperature"] || 0,
              maxTokens: modelProvider.modelProvider.args["max_tokens"],
            });
            break;

          case "ChatOllama":
            model = new ChatOllama({
              baseUrl: modelProvider.modelProvider.args["base_url"],
              model: modelProvider.modelProvider.args["model"],
              streaming: true,
              temperature: modelProvider.modelProvider.args["temperature"] || 0.1,
              numPredict: modelProvider.modelProvider.args["max_tokens"],
            });
            break;

          default:
            throw new Error(`Unsupported model provider: ${providerType}`);
        }

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
          await state.workflowManager.init({
            model: model,
            workspaceDir: state.data.workspaceRoot,
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
          let currentTaskManagerIterations = 0;
          // Clear any existing modified files state at the start of a new solution
          state.modifiedFiles.clear();
          const modifiedFilesPromises: Array<Promise<void>> = [];
          let lastMessageId: string = "0";

          // Track if we're waiting for user interaction
          let isWaitingForUserInteraction = false;
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

          /**
           * Handles a modified file message from the agent
           * 1. Processes the file modification
           * 2. Creates a diff for UI display
           * 3. Adds a chat message with accept/reject buttons
           * 4. Waits for user response before continuing
           */
          const handleModifiedFileMessage = async (
            msg: KaiWorkflowMessage,
            modifiedFiles: Map<string, ModifiedFileState>,
            modifiedFilesPromises: Array<Promise<void>>,
            processedTokens: Set<string>,
            pendingInteractions: Map<string, (response: any) => void>,
            messageQueue: KaiWorkflowMessage[],
            state: ExtensionState,
          ) => {
            // Ensure we're dealing with a ModifiedFile message
            if (msg.type !== KaiWorkflowMessageType.ModifiedFile) {
              console.error("handleModifiedFileMessage called with non-ModifiedFile message type");
              return;
            }

            // Get file info for UI display
            const { path: filePath } = msg.data as KaiModifiedFile;

            // Process the modified file and store it in the modifiedFiles map
            modifiedFilesPromises.push(
              processModifiedFile(modifiedFiles, msg.data as KaiModifiedFile),
            );

            const uri = Uri.file(filePath);

            try {
              // Wait for the file to be processed
              await Promise.all(modifiedFilesPromises);

              // Get file state from modifiedFiles map
              const fileState = modifiedFiles.get(uri.fsPath);
              if (fileState) {
                // Create a diff for UI display
                const isNew = fileState.originalContent === undefined;
                let diff: string;

                if (isNew) {
                  diff = createTwoFilesPatch("", filePath, "", fileState.modifiedContent);
                } else {
                  try {
                    diff = createPatch(
                      filePath,
                      fileState.originalContent as string,
                      fileState.modifiedContent,
                    );
                  } catch (diffErr) {
                    console.error(`Error creating diff for ${filePath}:`, diffErr);
                    diff = `// Error creating diff for ${filePath}`;
                  }
                }

                // Add a chat message with quick responses for user interaction
                state.mutateData((draft) => {
                  draft.chatMessages.push({
                    kind: ChatMessageType.ModifiedFile,
                    messageToken: msg.id,
                    timestamp: new Date().toISOString(),
                    value: {
                      path: filePath,
                      content: fileState.modifiedContent,
                      isNew: isNew,
                      diff: diff,
                      messageToken: msg.id, // Add message token to value for reference
                    },
                    quickResponses: [
                      { id: "apply", content: "Apply" },
                      { id: "reject", content: "Reject" },
                    ],
                  });
                });

                // Set the flag to indicate we're waiting for user interaction
                isWaitingForUserInteraction = true;
                console.log(`Waiting for user response for file: ${filePath}`);

                // Wait for user response - this blocks workflow execution until user responds
                await new Promise<void>((resolve) => {
                  // Store the resolver for this specific message
                  pendingInteractions.set(msg.id, (response: any) => {
                    // Handle the user response (apply/reject the file change)
                    console.log(`User ${response.action} file modification for ${filePath}`);

                    // Reset the waiting flag
                    isWaitingForUserInteraction = false;

                    // Process any messages that were queued while waiting
                    const queuedMessages = [...messageQueue];
                    messageQueue.length = 0;

                    // Process all queued messages before resolving the promise
                    // This ensures all messages are processed before continuing the workflow
                    (async () => {
                      try {
                        console.log(`Processing ${queuedMessages.length} queued messages...`);

                        // Add a processing indicator
                        // if (queuedMessages.length > 0) {
                        //   state.mutateData((draft) => {
                        //     draft.chatMessages.push({
                        //       kind: ChatMessageType.String,
                        //       messageToken: `queue-start-${Date.now()}`,
                        //       timestamp: new Date().toISOString(),
                        //       value: {
                        //         message: `Processing ${queuedMessages.length} queued messages...`,
                        //       },
                        //     });
                        //   });
                        // }

                        // Filter out any duplicate messages before processing
                        // For ModifiedFile messages, consider them duplicates if they modify the same file path
                        const uniqueQueuedMessages = queuedMessages.filter((msg, index, self) => {
                          if (msg.type === KaiWorkflowMessageType.ModifiedFile) {
                            // For file modifications, check if we already have a message for this file path
                            const filePath = (msg.data as KaiModifiedFile).path;
                            return (
                              self.findIndex(
                                (m) =>
                                  m.type === KaiWorkflowMessageType.ModifiedFile &&
                                  (m.data as KaiModifiedFile).path === filePath,
                              ) === index
                            );
                          }
                          // For other message types, just check the ID
                          return self.findIndex((m) => m.id === msg.id) === index;
                        });

                        console.log(
                          `Processing ${uniqueQueuedMessages.length} unique messages out of ${queuedMessages.length} queued messages`,
                        );

                        // Process each unique message sequentially
                        for (const queuedMsg of uniqueQueuedMessages) {
                          await processMessage(queuedMsg);
                        }

                        // Add a completion indicator
                        // if (queuedMessages.length > 0) {
                        //   state.mutateData((draft) => {
                        //     draft.chatMessages.push({
                        //       kind: ChatMessageType.String,
                        //       messageToken: `queue-complete-${Date.now()}`,
                        //       timestamp: new Date().toISOString(),
                        //       value: {
                        //         message: "✅ All queued messages have been processed.",
                        //       },
                        //     });
                        //   });
                        // }

                        // After processing queued messages
                        const hasPendingFileModifications = Array.from(modifiedFiles.values()).some(
                          (file) =>
                            file.editType === "inMemory" &&
                            file.modifiedContent !== file.originalContent,
                        );
                        const hasMoreQueuedMessages = messageQueue.length > 0;
                        console.log({
                          hasPendingFileModifications,
                          hasMoreQueuedMessages,
                          modifiedFiles,
                        });
                        state.mutateData((draft) => {
                          draft.chatMessages.push({
                            kind: ChatMessageType.String,
                            messageToken: `queue-status-${Date.now()}`,
                            timestamp: new Date().toISOString(),
                            value: {
                              message:
                                !hasPendingFileModifications && !hasMoreQueuedMessages
                                  ? "✅ All changes have been processed. You're up to date!"
                                  : "There are more changes to review.",
                            },
                            quickResponses:
                              !hasPendingFileModifications && !hasMoreQueuedMessages
                                ? [
                                    { id: "run-analysis", content: "Run Analysis" },
                                    { id: "return-analysis", content: "Return to Analysis Page" },
                                  ]
                                : undefined,
                          });
                        });

                        // Resolve our promise to continue the workflow
                        resolve();
                      } catch (error) {
                        console.error("Error processing queued messages:", error);

                        // Add an error indicator
                        state.mutateData((draft) => {
                          draft.chatMessages.push({
                            kind: ChatMessageType.String,
                            messageToken: `queue-error-${Date.now()}`,
                            timestamp: new Date().toISOString(),
                            value: {
                              message: `Error processing queued messages: ${error}`,
                            },
                          });
                        });

                        resolve(); // Resolve anyway to prevent hanging
                      }
                    })();
                  });
                });
              }
            } catch (err) {
              console.log(`Failed to process modified file from the agent - ${err}`);
              isWaitingForUserInteraction = false; // Reset flag in case of error
            }
          };

          /**
           * Determines if a message should be processed or skipped as a duplicate
           * This provides a centralized way to handle duplicate detection across all message types
           */
          const shouldProcessMessage = (msg: KaiWorkflowMessage): boolean => {
            // Special handling for different message types - NO generic duplicate check first
            switch (msg.type) {
              case KaiWorkflowMessageType.LLMResponseChunk: {
                // For LLM chunks, we only check for duplicates if it's a new message
                if (msg.id !== lastMessageId) {
                  // Check if we've already started a message with this ID
                  if (processedTokens.has(`llm-start:${msg.id}`)) {
                    console.log(`Skipping duplicate LLM start message: ${msg.id}`);
                    return false;
                  }
                  // Mark this message as started
                  processedTokens.add(`llm-start:${msg.id}`);
                }
                // Don't add message ID to processedTokens for LLM chunks
                // as we want to allow multiple chunks with the same ID
                return true;
              }
              case KaiWorkflowMessageType.ModifiedFile: {
                const { path: filePath } = msg.data as KaiModifiedFile;
                // Create a unique key for this file modification
                const fileKey = `file:${filePath}:${msg.id}`;

                // Check if we've already processed a message for this file path and ID
                if (processedTokens.has(fileKey)) {
                  console.log(`Skipping duplicate file modification for: ${filePath}`);
                  return false;
                }

                // Also check if we've already processed ANY message for this file path
                // This prevents multiple different messages modifying the same file
                const filePathKey = `file:${filePath}`;
                if (processedTokens.has(filePathKey)) {
                  console.log(
                    `Skipping duplicate file modification for path: ${filePath} (different message ID)`,
                  );
                  return false;
                }

                // Mark this specific file modification as processed
                processedTokens.add(fileKey);
                // Also mark the file path as processed to prevent other messages from modifying it
                processedTokens.add(filePathKey);
                return true;
              }
              case KaiWorkflowMessageType.ToolCall: {
                // For tool calls, create a unique key based on tool name and status
                const toolName = msg.data.name || "unnamed tool";
                const toolStatus = msg.data.status;
                const toolKey = `tool:${toolName}:${toolStatus}:${msg.id}`;

                if (processedTokens.has(toolKey)) {
                  console.log(`Skipping duplicate tool call: ${toolName} (${toolStatus})`);
                  return false;
                }

                processedTokens.add(toolKey);
                return true;
              }
              case KaiWorkflowMessageType.UserInteraction: {
                // For user interactions, create a unique key based on the interaction type
                const interaction = msg.data as KaiUserIteraction;
                const interactionKey = `interaction:${interaction.type}:${msg.id}`;

                if (processedTokens.has(interactionKey)) {
                  console.log(`Skipping duplicate user interaction: ${interaction.type}`);
                  return false;
                }

                processedTokens.add(interactionKey);
                return true;
              }
              default: {
                // For all other message types, use basic duplicate check by message ID
                if (processedTokens.has(msg.id)) {
                  console.log(`Skipping duplicate message with ID: ${msg.id}`);
                  return false;
                }
                processedTokens.add(msg.id);
                return true;
              }
            }
          };

          // Function to process a message
          const processMessage = async (msg: KaiWorkflowMessage) => {
            console.log("Commands processing message:", msg);

            // If we're waiting for user interaction and this is not a response to that interaction,
            // queue the message for later processing
            if (isWaitingForUserInteraction) {
              messageQueue.push(msg);
              return;
            }

            // Check if we should process this message or skip it as a duplicate
            if (!shouldProcessMessage(msg)) {
              return;
            }

            switch (msg.type) {
              case KaiWorkflowMessageType.ToolCall: {
                // Add or update tool call notification in chat
                state.mutateData((draft) => {
                  const toolName = msg.data.name || "unnamed tool";
                  const toolStatus = msg.data.status;
                  // Use a dedicated kind and value for tool messages
                  const existingToolIndex = draft.chatMessages.findIndex(
                    (m: any) =>
                      m.kind === ChatMessageType.Tool &&
                      (m.value as ToolMessageValue).toolName === toolName &&
                      (m.value as ToolMessageValue).toolStatus === toolStatus,
                  );

                  if (existingToolIndex === -1) {
                    draft.chatMessages.push({
                      kind: ChatMessageType.Tool,
                      messageToken: msg.id,
                      timestamp: new Date().toISOString(),
                      value: {
                        toolName,
                        toolStatus,
                      },
                    });
                  }
                });
                break;
              }
              case KaiWorkflowMessageType.UserInteraction: {
                const interaction = msg.data as KaiUserIteraction;
                switch (interaction.type) {
                  case "yesNo": {
                    try {
                      // Get the message from the interaction
                      const message =
                        interaction.systemMessage.yesNo || "Would you like to proceed?";

                      // Add the question to chat with quick responses
                      state.mutateData((draft) => {
                        // Check if we already have a pending interaction message
                        const hasPendingInteraction = draft.chatMessages.some(
                          (m: any) =>
                            m.kind === ChatMessageType.String &&
                            m.quickResponses &&
                            m.quickResponses.length > 0,
                        );

                        if (!hasPendingInteraction) {
                          draft.chatMessages.push({
                            kind: ChatMessageType.String,
                            messageToken: msg.id,
                            timestamp: new Date().toISOString(),
                            value: {
                              message: message,
                            },
                            quickResponses: [
                              { id: "yes", content: "Yes" },
                              { id: "no", content: "No" },
                            ],
                          });
                        }
                      });
                      // Response will be handled by QUICK_RESPONSE handler
                      break;
                    } catch (error) {
                      console.error("Error handling user interaction:", error);
                      msg.data.response = { yesNo: false };
                      await workflow.resolveUserInteraction(msg);
                    }
                    break;
                  }
                  case "choice": {
                    try {
                      const choices = interaction.systemMessage.choice || [];
                      state.mutateData((draft) => {
                        draft.chatMessages.push({
                          kind: ChatMessageType.String,
                          messageToken: msg.id,
                          timestamp: new Date().toISOString(),
                          value: {
                            message: "Please select an option:",
                          },
                          quickResponses: choices.map((choice: string, index: number) => ({
                            id: `choice-${index}`,
                            content: choice,
                          })),
                        });
                      });
                      // Response will be handled by QUICK_RESPONSE handler
                      break;
                    } catch (error) {
                      console.error("Error handling choice interaction:", error);
                      msg.data.response = { choice: -1 };
                      await workflow.resolveUserInteraction(msg);
                    }
                    break;
                  }
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
                              ? t
                                  .toString()
                                  .slice(0, 100)
                                  .replaceAll("`", "'")
                                  .replaceAll(">", "") + "..."
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
                        workflow.resolveUserInteraction(msg);
                      } else {
                        msg.data.response = {
                          yesNo: false,
                        };
                        workflow.resolveUserInteraction(msg);
                      }
                    } else {
                      msg.data.response = {
                        yesNo: false,
                      };
                      workflow.resolveUserInteraction(msg);
                    }
                  }
                }
                break;
              }
              case KaiWorkflowMessageType.LLMResponseChunk: {
                console.log("LLMResponseChunk", msg);
                const chunk = msg.data;
                const content =
                  typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);

                if (msg.id !== lastMessageId) {
                  // This is a new message - create a new chat message
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
                  // This is a continuation of the current message - append to it
                  state.mutateData((draft) => {
                    draft.chatMessages[draft.chatMessages.length - 1].value.message += content;
                  });
                }
                break;
              }
              case KaiWorkflowMessageType.ModifiedFile: {
                await handleModifiedFileMessage(
                  msg,
                  state.modifiedFiles,
                  modifiedFilesPromises,
                  processedTokens,
                  pendingInteractions,
                  messageQueue,
                  state,
                );
                break;
              }
            }
          };

          // Set up the event listener to use our message processing function

          workflow.removeAllListeners();
          workflow.on("workflowMessage", async (msg: KaiWorkflowMessage) => {
            await processMessage(msg);
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
          }

          // Process diffs from modified files
          await Promise.all(
            Array.from(state.modifiedFiles.entries()).map(async ([path, fileState]) => {
              const { originalContent, modifiedContent } = fileState;
              const uri = Uri.file(path);
              const relativePath = workspace.asRelativePath(uri);
              try {
                // revert the edit if needed
                if (originalContent !== undefined) {
                  await workspace.fs.writeFile(uri, new Uint8Array(Buffer.from(originalContent)));
                }
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
        // commands.executeCommand("konveyor.loadSolution", solutionResponse, { incidents });
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
  for (const [command, callback] of Object.entries(commandsMap(state))) {
    state.extensionContext.subscriptions.push(commands.registerCommand(command, callback));
  }
}
