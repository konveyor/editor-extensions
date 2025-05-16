import { basename } from "path";
import { promises as fsPromises } from "fs";
import { type EnhancedIncident } from "@editor-extensions/shared";
import { type DynamicStructuredTool } from "@langchain/core/tools";
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";

import {
  type AdditionalInfoSummarizeInputState,
  type AdditionalInfoSummarizeOutputState,
  type AddressAdditionalInfoInputState,
  type AddressAdditionalInfoOutputState,
  type AnalysisIssueFixInputState,
  type AnalysisIssueFixOutputState,
  type AnalysisIssueFixRouterState,
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
    this.fixAnalysisIssueRouter = this.fixAnalysisIssueRouter.bind(this);
    this.parseCodeMatchFromResponse = this.parseCodeMatchFromResponse.bind(this);
    this.parseAdditionalInformation = this.parseAdditionalInformation.bind(this);
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
      allResponses: [],
      fileUri: undefined,
      fileContent: undefined,
      incidentsDescription: undefined,
    };
    // we have to fix the incidents if there's at least one present in state
    if (state.currentIdx < state.incidentsByUris.length) {
      const nextEntry = state.incidentsByUris[state.currentIdx];
      if (nextEntry) {
        const incidentsDescription = (nextEntry.incidents as EnhancedIncident[])
          .map((incident) => `* ${incident.lineNumber}: ${incident.message}`)
          .join();
        try {
          const cachedContent = await this.fsCache.get(nextEntry.uri);
          if (cachedContent) {
            nextState.fileContent = cachedContent;
          }
          const fileContent = await fsPromises.readFile(nextEntry.uri, "utf8");
          nextState.fileContent = fileContent;
          nextState.fileUri = nextEntry.uri;
          nextState.incidentsDescription = incidentsDescription;
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
    if (state.response) {
      const codeSnip = this.parseCodeMatchFromResponse(state.response);
      if (codeSnip && state.fileUri) {
        this.fsCache.set(state.fileUri, codeSnip);
        this.emitWorkflowMessage({
          id: `res-modified-file-${Date.now()}`,
          type: KaiWorkflowMessageType.ModifiedFile,
          data: {
            path: state.fileUri,
            content: codeSnip,
          },
        });
      }
      nextState.allResponses = [state.response];
      nextState.response = undefined;
    }
    // if this was the last file we worked on, accumulate additional infromation
    if (state.currentIdx === state.incidentsByUris.length) {
      nextState.previousResponse = this.parseAdditionalInformation({
        files: state.incidentsByUris.map((e) => e.uri),
        responses: nextState.allResponses,
      });
    }
    return nextState;
  }

  // node that fixes given analysis issue
  async fixAnalysisIssue(
    state: typeof AnalysisIssueFixInputState.State,
  ): Promise<typeof AnalysisIssueFixOutputState.State> {
    if (!state.fileUri || !state.fileContent || !state.incidentsDescription) {
      return {
        response: undefined,
      };
    }

    const fileName = basename(state.fileUri);

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
${state.fileContent}
\`\`\`

## Issues
${state.incidentsDescription}

# Output Instructions
Structure your output in Markdown format such as:

## Reasoning
Write the step by step reasoning in this markdown section. If you are unsure of a step or reasoning, clearly state you are unsure and why.

## Updated File
// Write the updated file in this section. If the file should be removed, make the content of the updated file a comment explaining it should be removed.

## Additional Information (optional)

If you have any additional details or steps that need to be performed, put it here. Do not summarize any of the changes you already made in this section. Only mention any additional changes needed.`);

    const response = await this.streamOrInvoke([sysMessage, humanMessage], {
      emitEvents: true,
      enableTools: false,
    });

    return {
      response: !response ? undefined : this.aiMessageToString(response),
    };
  }

  // node that summarizes additional information into actionable items
  // this is needed because when addressing multiple files we may have
  // duplicate changes as well as unnecessary changes mentioned in output
  async summarizeAdditionalInformation(
    state: typeof AdditionalInfoSummarizeInputState.State,
  ): Promise<typeof AdditionalInfoSummarizeOutputState.State> {
    if (!state.previousResponse) {
      return {
        additionalInformation: "NO-CHANGE",
      };
    }

    const sys_message = new SystemMessage(
      `You are an experienced ${state.programmingLanguage} programmer, specializing in migrating source code to ${state.migrationHint}.`,
    );
    const human_message = new HumanMessage(
      `We have migrated some source code files to ${state.migrationHint}.\
You are given notes we captured during the migration.\
The notes contain a summary of changes we already made to existing files and additional changes that may be required in other files elsewhere in the project.\
They also contain a list of files we changed.\
Carefully analyze the notes and understand what additional changes are mentioned in the notes.\
Output the additional changes mentioned in the notes. Do not output any of the changes we have already made.\
Make sure you output all the details about the changes including code snippets and instructions.\
Ensure you do not omit any additional changes needed.\
If there are no additional changes mentioned, respond with text "NO-CHANGE".\
Here is the summary: \
${state.previousResponse}`,
    );

    const response = await this.streamOrInvoke([sys_message, human_message], {
      // this is basically thinking part, we
      // don't want to share with user this part
      emitEvents: false,
      enableTools: false,
    });

    return {
      additionalInformation: this.aiMessageToString(response),
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
${state.additionalInformation}`),
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
        modifiedFiles,
      };
    }

    return {
      messages: [response],
      modifiedFiles,
    };
  }

  private parseAdditionalInformation(responses: { files: string[]; responses: string[] }): string {
    let reasoning = "";
    let additionalInfo = "";
    for (const res of responses.responses) {
      let parserState = "initial";
      for (const resLine of res.split("\n")) {
        const nextState = (line: string) =>
          line.match(/(##|\*\*) *[R|r]easoning/)
            ? "reasoning"
            : line.match(/(##|\*\*) *[U|u]pdated [F|f]ile/)
              ? "updatedFile"
              : line.match(/(##|\*\*) *[A|a]dditional *[I|i]nformation/)
                ? "additionalInfo"
                : undefined;

        const nxtState = nextState(resLine);
        parserState = nxtState || parserState;
        if (nxtState === undefined) {
          switch (parserState) {
            case "reasoning":
              reasoning += `\n${resLine}`;
              break;
            case "additionalInfo":
              additionalInfo += `\n${resLine}`;
              break;
          }
        }
      }
    }
    return `## Summary of changes made\n\n${reasoning}\n\n\
## Additional Information\n\n${additionalInfo}\n\n\
## List of files changed\n\n${responses.files.join("\n")}`;
  }

  private parseCodeMatchFromResponse(response: string): string | undefined {
    const codeMatch = response.match(/```\w*\n([\s\S]*?)\n```/);
    return codeMatch ? (codeMatch.length > 0 ? codeMatch[1] : undefined) : undefined;
  }
}
