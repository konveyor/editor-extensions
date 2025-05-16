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
  type KaiModifiedFile,
  type KaiWorkflowMessage,
  KaiWorkflowMessageType,
  type KaiInteractiveWorkflowInput,
  type KaiUserIteraction,
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
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import path from "path";

const isWindows = process.platform === "win32";

// System prompt for the LLM
const systemPrompt = `You are an expert software developer helping with code migration. 
Your task is to analyze code and suggest changes to fix issues identified by static analysis.
Be thorough in your analysis and provide clear explanations for your changes.`;

const commandsMap: (state: ExtensionState) => {
  [command: string]: (...args: any) => any;
} = (state) => {
  // Track the last message ID for streaming responses
  let lastMessageId: string = "0";

  // Map to store agent-modified files
  const agentModifiedFiles = new Map<Uri, { content: string; isNew: boolean }>();

  // Map to store modified files
  const modifiedFiles = new Map<string, { content: string; isNew: boolean }>();

  // Flag to track if files have been modified
  const alreadyModified = false;

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

      // Group incidents by URI
      const incidentsByUri = incidents.reduce(
        (acc, incident) => {
          if (!acc[incident.uri]) {
            acc[incident.uri] = [];
          }
          acc[incident.uri].push(incident);
          return acc;
        },
        {} as { [uri: string]: EnhancedIncident[] },
      );

      // Create a scope for the solution
      const scope: Scope = { incidents, effort };

      // Update the state to indicate we're starting to fetch a solution
      state.mutateData((draft) => {
        draft.isFetchingSolution = true;
        draft.solutionState = "started";
        draft.solutionScope = scope;
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

        // Process each file's incidents
        const allDiffs: { original: string; modified: string; diff: string }[] = [];
        const modifiedFiles: Map<string, modifiedFileState> = new Map<string, modifiedFileState>();
        const modifiedFilesPromises: Array<Promise<void>> = [];
        let lastMessageId: string = "0";

          // Set up the event listener
          workflow.on("workflowMessage", async (msg: KaiWorkflowMessage) => {
            console.log("Commands received message:", msg);
            switch (msg.type) {
              case KaiWorkflowMessageType.ToolCall: {
                // Skip if we've already processed this message
                if (processedTokens.has(msg.id)) {
                  return;
                }
                processedTokens.add(msg.id);

                // Add or update tool call notification in chat
                state.mutateData((draft) => {
                  const toolName = msg.data.name || "unnamed tool";
                  const toolStatus = msg.data.status;
                  // Use a dedicated kind and value for tool messages
                  const existingToolIndex = draft.chatMessages.findIndex(
                    (m) =>
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
                      // Skip if we've already processed this message
                      if (processedTokens.has(msg.id)) {
                        return;
                      }
                      processedTokens.add(msg.id);

                      // Get the message from the interaction
                      const message =
                        interaction.systemMessage.yesNo || "Would you like to proceed?";

                      // Add the question to chat with quick responses
                      state.mutateData((draft) => {
                        // Check if we already have a pending interaction message
                        const hasPendingInteraction = draft.chatMessages.some(
                          (m) =>
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
                const fPath = msg.data.path;
                const content = msg.data.content;
                const uri = Uri.file(fPath);
                let isNew = false;
                try {
                  try {
                    await workspace.fs.stat(uri);
                  } catch (err) {
                    if (
                      (err as any).code === "FileNotFound" ||
                      (err as any).name === "EntryNotFound"
                    ) {
                      isNew = true;
                    } else {
                      throw err;
                    }
                  }

                  // Store the file in the agentModifiedFiles Map
                  if (!agentModifiedFiles.has(uri)) {
                    agentModifiedFiles.set(uri, {
                      content,
                      isNew,
                    });

                    // Create a diff for the modified file
                    let diff: string;
                    if (isNew) {
                      // For new files, create a diff showing the entire file as added
                      diff = createTwoFilesPatch("", fPath, "", content);
                    } else {
                      try {
                        // For existing files, create a diff between the original and modified content
                        const originalContent = await workspace.fs.readFile(uri);
                        diff = createPatch(
                          fPath,
                          new TextDecoder().decode(originalContent),
                          content,
                        );
                      } catch (diffErr) {
                        console.error(`Error creating diff for ${fPath}:`, diffErr);
                        diff = `// Error creating diff for ${fPath}`;
                      }
                    }

                    // Skip if we've already processed this message
                    if (processedTokens.has(msg.id)) {
                      return;
                    }
                    processedTokens.add(msg.id);

                    // Add a chat message of type ModifiedFile with quick responses
                    state.mutateData((draft) => {
                      draft.chatMessages.push({
                        kind: ChatMessageType.ModifiedFile,
                        messageToken: msg.id,
                        timestamp: new Date().toISOString(),
                        value: {
                          path: fPath,
                          content: content,
                          isNew: isNew,
                          diff: diff,
                        },
                        quickResponses: [
                          { id: "apply", content: "Apply" },
                          { id: "reject", content: "Reject" },
                        ],
                      });
                    });

                    // Pause the workflow until the user responds
                    // The response will be handled by FILE_RESPONSE handler
                  }
                } catch (err) {
                  console.log(`Failed to write file by the agent - ${err}`);
                }
                break;
              }
            }
          });
        }

        // Process each file's incidents
        const allDiffs: { original: string; modified: string; diff: string }[] = [];
        const allResponses: string[] = [];
        const allRelativePaths: string[] = [];

        for (const [uri, fileIncidents] of Object.entries(incidentsByUri)) {
          const parsedURI = Uri.parse(uri);
          const relativePath = workspace.asRelativePath(parsedURI);
          const basename = path.basename(parsedURI.fsPath);

          state.mutateData((draft) => {
            draft.chatMessages.push({
              messageToken: `m${Date.now()}`,
              kind: ChatMessageType.String,
              value: {
                message: `Analyzing file: ${relativePath} with incidents: ${(fileIncidents as EnhancedIncident[]).map((incident) => incident.violationId).join(", ")}\n\n`,
              },
              timestamp: new Date().toISOString(),
            });
          });

          // Get the entire file content
          const doc = await workspace.openTextDocument(parsedURI);
          const fileContent = doc.getText();

          // Prepare the incidents description for this file
          const incidentsDescription = (fileIncidents as EnhancedIncident[])
            .map((incident) => `* ${incident.lineNumber}: ${incident.message}`)
            .join();

          // Prepare the human prompt
          const humanPrompt = `
I will give you a file for which I want to take one step towards migrating ${profileName}.
I will provide you with static source code analysis information highlighting an issue which needs to be addressed.
Fix all the issues described. Other problems will be solved in subsequent steps so it is unnecessary to handle them now.
Before attempting to migrate the code from ${profileName}, reason through what changes are required and why.

Pay attention to changes you make and impacts to external dependencies in the pom.xml as well as changes to imports we need to consider.
Remember when updating or adding annotations that the class must be imported.
As you make changes that impact the pom.xml or imports, be sure you explain what needs to be updated.
After you have shared your step by step thinking, provide a full output of the updated file.

# Input information

## Input File

File name: "${basename}"
Source file contents:
\`\`\`
${fileContent}
\`\`\`

## Issues
${incidentsDescription}

# Output Instructions
Structure your output in Markdown format such as:

## Reasoning
Write the step by step reasoning in this markdown section. If you are unsure of a step or reasoning, clearly state you are unsure and why.

## Updated File
// Write the updated file in this section. If the file should be removed, make the content of the updated file a comment explaining it should be removed.

## Additional Information (optional)

If you have any additional details or steps that need to be performed, put it here. Do not summarize any of the changes you already made in this section. Only mention any additional changes needed.`;

          // Stream the response
          const stream = await model.stream([
            new SystemMessage(systemPrompt),
            new HumanMessage(humanPrompt),
          ]);

          // Process the stream
          let fullResponse = "";
          for await (const chunk of stream) {
            const content =
              typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);
            fullResponse += chunk.content;
            state.mutateData((draft) => {
              draft.chatMessages[draft.chatMessages.length - 1].value.message += content;
            });
          }
          allResponses.push(fullResponse);
          allRelativePaths.push(relativePath);

          // Add logging to help diagnose the issue
          console.log(`Processing response for ${relativePath}:`);
          console.log(`Response length: ${fullResponse.length}`);

          // Match any language identifier after the backticks
          const codeMatch = fullResponse.match(/```\w*\n([\s\S]*?)\n```/);
          if (codeMatch) {
            console.log(`Found code block in response for ${relativePath}`);
            const modifiedContent = codeMatch[1];
            const originalContent = fileContent;
            // Use relative path for the diff to match the expected format
            const diff = createPatch(relativePath, originalContent, modifiedContent, "", "", {
              context: 3,
            });

            allDiffs.push({
              original: relativePath,
              modified: relativePath,
              diff,
            });
            modifiedFiles.set(parsedURI.fsPath, { content: modifiedContent, isNew: false });
          } else {
            console.log(`No code block found in response for ${relativePath}`);
            console.log(`Response content: ${fullResponse.substring(0, 500)}...`); // Log first 500 chars
          }
        }

        if (state.workflowManager.workflow) {
          try {
            await state.workflowManager.workflow?.run({
              migrationHint: profileName,
              previousResponses: {
                responses: allResponses,
                files: allRelativePaths,
              },
              programmingLanguage: "Java",
            } as KaiInteractiveWorkflowInput);
          } catch (err) {
            console.error(`Error in running the agent - ${err}`);
            window.showInformationMessage(`We encountered an error running the agent.`);
          }

          // Process diffs from agent workflow
          await Promise.all(
            Array.from(agentModifiedFiles.entries()).map(async ([uri, { content, isNew }]) => {
              const relativePath = workspace.asRelativePath(uri);
              try {
                if (isNew) {
                  allDiffs.push({
                    diff: createTwoFilesPatch("", relativePath, "", content),
                    modified: relativePath,
                    original: "",
                  });
                } else {
                  const { isNew } = modifiedFiles.get(uri.fsPath) ?? { isNew: false };
                  modifiedFiles.set(uri.fsPath, {
                    content,
                    isNew,
                  });
                }
                if (getConfigSuperAgentMode()) {
                  if (isNew && !alreadyModified) {
                    await workspace.fs.writeFile(uri, new Uint8Array(Buffer.from("")));
                  }
                  try {
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
              } catch (err) {
                console.log(`Failed to write file by the agent - ${err}`);
              }
            }),
          );
        }

        // Process diffs from modified files
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

        // Reset the cache after all agents have returned
        state.kaiFsCache.reset();

        if (allDiffs.length === 0) {
          console.error("No diffs found in any of the responses");
          console.log("All responses:", allResponses);
          throw new Error(
            "No diffs found in the response. Please ensure the response contains code blocks marked with triple backticks (```).",
          );
        }

        // Create a solution response with properly structured changes
        const solutionResponse: GetSolutionResult = {
          changes: allDiffs,
          encountered_errors: [],
          scope: { incidents, effort },
        };

        // Update the state with the solution and reasoning
        state.mutateData((draft) => {
          draft.solutionState = "received";
          draft.isFetchingSolution = false;
          draft.solutionData = solutionResponse;
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
  for (const [command, callback] of Object.entries(commandsMap(state))) {
    state.extensionContext.subscriptions.push(commands.registerCommand(command, callback));
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
