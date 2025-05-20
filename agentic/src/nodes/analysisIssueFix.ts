import { basename } from "path";
import { promises as fsPromises } from "fs";
import { type EnhancedIncident } from "@editor-extensions/shared";
import { type DynamicStructuredTool } from "@langchain/core/tools";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";

import {
  type AnalysisFixSummarizeInputState,
  type AdditionalInfoSummarizeOutputState,
  type AddressAdditionalInfoInputState,
  type AddressAdditionalInfoOutputState,
  type AnalysisIssueFixInputState,
  type AnalysisIssueFixOutputState,
  type AnalysisIssueFixRouterState,
  type SummarizeHistoryOutputState,
} from "../schemas/analysisIssueFix";
import { BaseNode, type ModelInfo } from "./base";
import { type KaiModifiedFile, type KaiFsCache, KaiWorkflowMessageType } from "../types";

export class AnalysisIssueFix extends BaseNode {
  constructor(
    modelInfo: ModelInfo,
    tools: DynamicStructuredTool[],
    private readonly fsCache: KaiFsCache,
  ) {
    super("AnalysisIssueFix", modelInfo, tools);

    this.fsCache = fsCache;
    this.fixAnalysisIssue = this.fixAnalysisIssue.bind(this);
    this.summarizeHistory = this.summarizeHistory.bind(this);
    this.fixAnalysisIssueRouter = this.fixAnalysisIssueRouter.bind(this);
    this.parseAnalysisFixResponse = this.parseAnalysisFixResponse.bind(this);
    this.addressAdditionalInformation = this.addressAdditionalInformation.bind(this);
    this.summarizeAdditionalInformation = this.summarizeAdditionalInformation.bind(this);
  }

  // node responsible for routing analysis issue fixes
  // processes input / output to / from analysis fix node
  // glorified for loop in a state machine
  async fixAnalysisIssueRouter(
    state: typeof AnalysisIssueFixRouterState.State,
  ): Promise<typeof AnalysisIssueFixRouterState.State> {
    const nextState: typeof AnalysisIssueFixRouterState.State = {
      ...state,
      // since we are using a reducer, allResponses has to be reset
      outputAllResponses: [],
      inputFileUri: undefined,
      inputFileContent: undefined,
      inputIncidentsDescription: undefined,
    };
    // we have to fix the incidents if there's at least one present in state
    if (state.currentIdx < state.inputIncidentsByUris.length) {
      const nextEntry = state.inputIncidentsByUris[state.currentIdx];
      if (nextEntry) {
        const incidentsDescription = (nextEntry.incidents as EnhancedIncident[])
          .map((incident) => `* ${incident.lineNumber}: ${incident.message}`)
          .join();
        try {
          const cachedContent = await this.fsCache.get(nextEntry.uri);
          if (cachedContent) {
            nextState.inputFileContent = cachedContent;
          }
          const fileContent = await fsPromises.readFile(nextEntry.uri, "utf8");
          nextState.inputFileContent = fileContent;
          nextState.inputFileUri = nextEntry.uri;
          nextState.inputIncidentsDescription = incidentsDescription;
        } catch (err) {
          this.emitWorkflowMessage({
            type: KaiWorkflowMessageType.Error,
            data: String(err),
            id: `res-read-file-${Date.now()}`,
          });
        }
        nextState.currentIdx = state.currentIdx + 1;
      }
    }
    // if there was any previous response from analysis node, accumulate it
    if (state.outputUpdatedFile && state.outputUpdatedFileUri) {
      this.fsCache.set(state.outputUpdatedFileUri, state.outputUpdatedFile);
      this.emitWorkflowMessage({
        id: `res-modified-file-${Date.now()}`,
        type: KaiWorkflowMessageType.ModifiedFile,
        data: {
          path: state.outputUpdatedFileUri,
          content: state.outputUpdatedFile,
        },
      });
      nextState.outputAllResponses = [
        {
          ...state,
        },
      ];
      nextState.outputUpdatedFile = undefined;
      nextState.outputAdditionalInfo = undefined;
    }
    // if this was the last file we worked on, accumulate additional infromation
    if (state.currentIdx === state.inputIncidentsByUris.length) {
      const accumulated = [...state.outputAllResponses, ...nextState.outputAllResponses].reduce(
        (acc, val) => {
          return {
            reasoning: `${acc.reasoning}\n${val.outputReasoning}`,
            additionalInfo: `${acc.additionalInfo}\n${val.outputAdditionalInfo}`,
          };
        },
        {
          reasoning: "",
          additionalInfo: "",
        } as { reasoning: string; additionalInfo: string },
      );
      nextState.inputAllAdditionalInfo = accumulated.additionalInfo;
      nextState.inputAllReasoning = accumulated.reasoning;
    }
    return nextState;
  }

  // node that fixes given analysis issue
  async fixAnalysisIssue(
    state: typeof AnalysisIssueFixInputState.State,
  ): Promise<typeof AnalysisIssueFixOutputState.State> {
    if (!state.inputFileUri || !state.inputFileContent || !state.inputIncidentsDescription) {
      return {
        outputUpdatedFile: undefined,
        outputAdditionalInfo: undefined,
        outputReasoning: undefined,
        outputUpdatedFileUri: state.inputFileUri,
      };
    }

    const fileName = basename(state.inputFileUri);

    const sysMessage = new SystemMessage(
      `You are an experienced java developer, who specializes in migrating code from ${state.migrationHint}`,
    );

    const humanMessage =
      new HumanMessage(`I will give you a file for which I want to take one step towards migrating ${state.migrationHint}.
I will provide you with static source code analysis information highlighting an issue which needs to be addressed.
Fix all the issues described. Other problems will be solved in subsequent steps so it is unnecessary to handle them now.
Before attempting to migrate the code from ${state.migrationHint}, reason through what changes are required and why.

Pay attention to changes you make and impacts to external dependencies in the pom.xml as well as changes to imports we need to consider.
Remember when updating or adding annotations that the class must be imported.
As you make changes that impact the pom.xml or imports, be sure you explain what needs to be updated.
After you have shared your step by step thinking, provide a full output of the updated file.

# Input information

## Input File

File name: "${fileName}"
Source file contents:
\`\`\`
${state.inputFileContent}
\`\`\`

## Issues
${state.inputIncidentsDescription}

# Output Instructions
Structure your output in Markdown format such as:

## Reasoning
Write the step by step reasoning in this markdown section. If you are unsure of a step or reasoning, clearly state you are unsure and why.

## Updated File
// Write the updated file in this section. If the file should be removed, make the content of the updated file a comment explaining it should be removed.

## Additional Information (optional)

If you have any additional details or steps that need to be performed, put it here. Do not summarize any of the changes you already made in this section. Only mention any additional changes needed.`);

    const response = await this.streamOrInvoke([sysMessage, humanMessage], {
      emitResponseChunks: true,
      enableTools: false,
    });

    if (!response) {
      return {
        outputAdditionalInfo: undefined,
        outputUpdatedFile: undefined,
        outputReasoning: undefined,
        outputUpdatedFileUri: state.inputFileUri,
      };
    }

    const { additionalInfo, reasoning, updatedFile } = this.parseAnalysisFixResponse(response);

    return {
      outputReasoning: reasoning,
      outputUpdatedFile: updatedFile,
      outputAdditionalInfo: additionalInfo,
      outputUpdatedFileUri: state.inputFileUri,
    };
  }

  // node that summarizes additional information into actionable items
  // this is needed because when addressing multiple files we may have
  // duplicate changes as well as unnecessary changes mentioned in output
  async summarizeAdditionalInformation(
    state: typeof AnalysisFixSummarizeInputState.State,
  ): Promise<typeof AdditionalInfoSummarizeOutputState.State> {
    if (!state.inputAllAdditionalInfo) {
      return {
        summarizedAdditionalInfo: "NO-CHANGE",
      };
    }

    const sys_message = new SystemMessage(
      `You are an experienced ${state.programmingLanguage} programmer, specializing in migrating source code to ${state.migrationHint}. You are overlooking migration of a project.`,
    );
    const human_message = new HumanMessage(
      `During the migration to ${state.migrationHint}, we captured notes detailing changes made to existing files.\
The notes contain a summary of changes we already and additional changes that may be required in other files elsewhere in the project.\
They also contain a list of files we changed.\
Your task is to carefully analyze these notes and provide a concise summary *solely* of the additional changes required elsewhere in the project.
**It is essential that your summary includes only the additional changes needed. Do not include changes already made.**\
Make sure you output all the details about the changes including code snippets and instructions.\
Ensure you do not omit any additional changes needed.\
If there are no additional changes mentioned, respond with text "NO-CHANGE".\
Here is the summary: \
${
  state.inputAllReasoning && state.inputAllReasoning.length > 0
    ? `### Summary of changes made\n${state.inputAllReasoning}`
    : ""
}
### Additional information about changes
${state.inputAllAdditionalInfo}
### List of modified files
${state.inputAllFileUris?.join("\n")}
`,
    );

    const response = await this.streamOrInvoke([sys_message, human_message], {
      // this is basically thinking part, we
      // don't want to share with user this part
      emitResponseChunks: false,
      enableTools: false,
    });

    return {
      summarizedAdditionalInfo: this.aiMessageToString(response),
    };
  }

  // node that summarizes changes made so far which can later be used as
  // context by other agents so they are aware of the full picture
  async summarizeHistory(
    state: typeof AnalysisFixSummarizeInputState.State,
  ): Promise<typeof SummarizeHistoryOutputState.State> {
    if (!state.inputAllReasoning) {
      return {
        summarizedHistory: "",
      };
    }

    const sys_message = new SystemMessage(
      `You are an experienced ${state.programmingLanguage} programmer, specializing in migrating source code to ${state.migrationHint}.`,
    );
    const human_message = new HumanMessage(
      `During the migration to ${state.migrationHint}, we captured the following notes detailing changes made to existing files.\
These notes may also mention potential future changes.\
Your task is to carefully analyze these notes and provide a concise summary *solely* of the changes that have already been implemented.\
**It is essential that your summary includes only the modifications explicitly described as completed and accurately reflects the list of files already changed.\
Do not include any information about potential future changes.**\
This summary will serve as a record of completed modifications for other team members.\
Here are the notes:
### Reasoning for fixes made
${state.inputAllReasoning}`,
    );

    const response = await this.streamOrInvoke([sys_message, human_message], {
      emitResponseChunks: false,
      enableTools: false,
    });

    if (!response) {
      return {
        summarizedHistory: "",
      };
    }

    return {
      summarizedHistory: this.aiMessageToString(response),
    };
  }

  // node responsible for addressing the additional changes
  async addressAdditionalInformation(
    state: typeof AddressAdditionalInfoInputState.State,
  ): Promise<typeof AddressAdditionalInfoOutputState.State> {
    const sys_message = new SystemMessage(
      `You are an experienced ${state.programmingLanguage} programmer, specializing in migrating source code from ${state.migrationHint}.\
We updated a source code file to migrate the source code. There may be more changes needed elsewhere in the project.\
You are given notes detailing additional changes that need to happen.\
Carefully analyze the changes and understand what files in the project need to be changed.\
The notes may contain details about changes already made. Please do not act on any of the changes already made. Assume they are correct and only focus on any additional changes needed.\
You have access to a set of tools to search for files, read a file and write to a file.\
Work on one file at a time. Completely address changes in one file before moving onto to next file.\
Respond with DONE when you're done addressing all the changes or there are no additional changes.\
`,
    );

    const chat: BaseMessage[] = state.messages;

    if (state.messages.length === 0) {
      chat.push(sys_message);
      chat.push(
        new HumanMessage(`
Here are the notes:\
${state.summarizedAdditionalInfo}`),
      );
    }

    const modifiedFiles: KaiModifiedFile[] = [];

    this.on("workflowMessage", (msg) => {
      if (msg.type === KaiWorkflowMessageType.ModifiedFile) {
        modifiedFiles.push(msg.data);
      }
    });

    const response = await this.streamOrInvoke(chat);

    if (!response) {
      return {
        messages: [new AIMessage(`DONE`)],
        outputModifiedFiles: modifiedFiles,
      };
    }

    return {
      messages: [response],
      outputModifiedFiles: modifiedFiles,
    };
  }

  private parseAnalysisFixResponse(response: AIMessage | AIMessageChunk): {
    updatedFile: string;
    reasoning: string;
    additionalInfo: string;
  } {
    const parsed: {
      updatedFile: string;
      reasoning: string;
      additionalInfo: string;
    } = {
      updatedFile: "",
      reasoning: "",
      additionalInfo: "",
    };
    const content = typeof response.content === "string" ? response.content : "";
    let parserState: "reasoning" | "updatedFile" | "additionalInfo" | undefined = undefined;
    for (const resLine of content.split("\n")) {
      const nextState = (line: string) =>
        line.match(/(##|\*\*) *[R|r]easoning/)
          ? "reasoning"
          : line.match(/(##|\*\*) *[U|u]pdated *[F|f]ile/)
            ? "updatedFile"
            : line.match(/(##|\*\*) *[A|a]dditional *[I|i]nformation/)
              ? "additionalInfo"
              : undefined;

      const nxtState = nextState(resLine);
      parserState = nxtState ?? parserState;
      if (nxtState === undefined) {
        switch (parserState) {
          case "reasoning":
            parsed.reasoning += `\n${resLine}`;
            break;
          case "additionalInfo":
            parsed.additionalInfo += `\n${resLine}`;
            break;
          case "updatedFile":
            if (!resLine.match(/```\w*/)) {
              parsed.updatedFile += `\n${resLine}`;
            }
            break;
        }
      }
    }
    parsed.updatedFile = parsed.updatedFile.trim();
    return parsed;
  }
}
