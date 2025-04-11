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
  extensions,
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
  updateCustomRules,
  updateUseDefaultRuleSets,
  getConfigLabelSelector,
  updateLabelSelector,
  updateGetSolutionMaxDepth,
  updateGetSolutionMaxIterations,
  updateGetSolutionMaxPriority,
  getConfigPromptTemplate,
} from "./utilities/configuration";
import { runPartialAnalysis } from "./analysis";
import { fixGroupOfIncidents, IncidentTypeItem } from "./issueView";
import { paths } from "./paths";
import { checkIfExecutable, copySampleProviderSettings } from "./utilities/fileUtils";
import { configureSourcesTargetsQuickPick } from "./configureSourcesTargetsQuickPick";
import Mustache from "mustache";
import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import * as vscode from "vscode";
import { getModelProvider } from "./client/modelProvider";
import { createPatch } from "diff";

const isWindows = process.platform === "win32";

const commandsMap: (state: ExtensionState) => {
  [command: string]: (...args: any) => any;
} = (state) => {
  return {
    "konveyor.startServer": async () => {
      const analyzerClient = state.analyzerClient;
      if (!(await analyzerClient.canAnalyzeInteractive())) {
        return;
      }
      try {
        await analyzerClient.start();
        await analyzerClient.initialize();
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
        await analyzerClient.initialize();
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
      await vscode.commands.executeCommand("konveyor.showResolutionPanel");

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

        // Initialize the OpenAI model with the configuration from the model provider
        const model = new ChatOpenAI({
          openAIApiKey: modelProvider.env.OPENAI_API_KEY,
          modelName: modelProvider.modelProvider.args["model"],
          streaming: true,
          temperature: 0.7,
        });

        // Prepare the system prompt
        const systemPrompt = `
You are an experienced java developer, who specializes in migrating code from
spring to quarkus.  You are also an expert in migrating code from java 8 to java
17.  Your task is to analyze the provided incidents and suggest code changes to
resolve them.  First, explain your reasoning and approach to fixing the issues.
Then, provide the actual code changes as a unified diff that can be applied to
the codebase.

# Output Instructions
Structure your output in Markdown format such as:

## Reasoning
Write the step by step reasoning in this markdown section. If you are unsure of a step or reasoning, clearly state you are unsure and why.

## Modified Code
\`\`\`java
// Return the complete file content with your changes
// Do not include diff markers or git headers
// Just return the file as it should look after changes
\`\`\`

## Additional Information

If you have any additional details or steps that need to be performed, put it here.`;

        // Process each file's incidents
        const allDiffs: { original: string; modified: string; diff: string }[] = [];
        const modifiedFiles = new Set<string>();

        for (const [uri, fileIncidents] of Object.entries(incidentsByUri)) {
          const parsedURI = Uri.parse(uri);
          const relativePath = workspace.asRelativePath(parsedURI);

          state.mutateData((draft) => {
            draft.chatMessages.push(
              {
                messageToken: `m${Date.now()}`,
                kind: ChatMessageType.String,
                value: {
                  message: `Analyzing file: ${relativePath} with incidents: ${fileIncidents.map((incident) => incident.violationId).join(", ")}\n\n`,
                },
                timestamp: new Date().toISOString(),
              },
              {
                messageToken: `m${Date.now()}`,
                kind: ChatMessageType.String,
                value: { message: "" },
                timestamp: new Date().toISOString(),
              },
            );
          });

          // Get the entire file content
          const doc = await workspace.openTextDocument(parsedURI);
          const fileContent = doc.getText();

          // Prepare the incidents description for this file
          const incidentsDescription = fileIncidents
            .map((incident) => `* ${incident.lineNumber}: ${incident.message}`)
            .join();

          // Prepare the human prompt
          const humanPrompt = `Please analyze these incidents in the file and suggest code changes:
File: ${uri}

Incidents:
${incidentsDescription}

File Content:
\`\`\`
${fileContent}
\`\`\`

Please provide a solution that addresses these issues.`;

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

          // Match any language identifier after the backticks
          const codeMatch = fullResponse.match(/```\w*\n([\s\S]*?)\n```/);
          if (codeMatch) {
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
            modifiedFiles.add(parsedURI.fsPath);
          }
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
        vscode.commands.executeCommand("konveyor.loadSolution", solutionResponse, { incidents });
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

        vscode.window.showErrorMessage(`Failed to generate solution: ${error.message}`);
      }
    },
    "konveyor.askContinue": async (incident: EnhancedIncident) => {
      // This should be a redundant check as we shouldn't render buttons that
      // map to this command when continue is not installed.
      const continueExt = extensions.getExtension("Continue.continue");
      if (!continueExt) {
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

        const promptTemplate = getConfigPromptTemplate();
        const prompt = Mustache.render(promptTemplate, incident);
        // Execute the Continue command with prompt and range
        await commands.executeCommand(
          "continue.customQuickActionSendToChat",
          prompt,
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
        await updateCustomRules(customRules);

        // Ask the user if they want to disable the default ruleset
        const useDefaultRulesets = await window.showQuickPick(["Yes", "No"], {
          placeHolder: "Do you want to use the default rulesets?",
          canPickMany: false,
        });

        if (useDefaultRulesets === "Yes") {
          await updateUseDefaultRuleSets(true);
        } else if (useDefaultRulesets === "No") {
          await updateUseDefaultRuleSets(false);
        }

        window.showInformationMessage(
          `Custom Rules Updated: ${customRules}\nUse Default Rulesets: ${useDefaultRulesets}`,
        );
      } else {
        window.showInformationMessage("No custom rules selected.");
      }
    },
    "konveyor.configureSourcesTargets": async () => {
      configureSourcesTargetsQuickPick();
    },
    "konveyor.configureLabelSelector": async () => {
      const currentLabelSelector = getConfigLabelSelector();

      const modifiedLabelSelector = await window.showInputBox({
        prompt: "Modify the label selector if needed",
        value: currentLabelSelector,
        placeHolder: "e.g., source=(java|spring) target=(quarkus)",
      });

      if (modifiedLabelSelector === undefined) {
        return;
      }

      // Update the user settings
      await updateLabelSelector(modifiedLabelSelector);
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
