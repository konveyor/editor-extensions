import { basename, relative } from "path";
import {
  type AIMessage,
  type AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { promises as fsPromises } from "fs";
import { type DynamicStructuredTool } from "@langchain/core/tools";
import { createPatch } from "diff";

import {
  type SummarizeAdditionalInfoInputState,
  type AnalysisIssueFixInputState,
  type AnalysisIssueFixOutputState,
  type AnalysisIssueFixOrchestratorState,
  type SummarizeAdditionalInfoOutputState,
  type SummarizeHistoryOutputState,
} from "../schemas/analysisIssueFix";
import { BaseNode, type ModelInfo } from "./base";
import { type KaiFsCache, KaiWorkflowMessageType } from "../types";
import { type GetBestHintResult, SolutionServerClient } from "../clients/solutionServerClient";

type IssueFixResponseParserState = "reasoning" | "updatedFile" | "additionalInfo";

export class AnalysisIssueFix extends BaseNode {
  constructor(
    modelInfo: ModelInfo,
    tools: DynamicStructuredTool[],
    private readonly fsCache: KaiFsCache,
    private readonly workspaceDir: string,
    private readonly solutionServerClient: SolutionServerClient,
  ) {
    super("AnalysisIssueFix", modelInfo, tools);
    this.fsCache = fsCache;
    this.workspaceDir = workspaceDir;
    this.solutionServerClient = solutionServerClient;

    this.fixAnalysisIssue = this.fixAnalysisIssue.bind(this);
    this.summarizeHistory = this.summarizeHistory.bind(this);
    this.fixAnalysisIssueRouter = this.fixAnalysisIssueRouter.bind(this);
    this.parseAnalysisFixResponse = this.parseAnalysisFixResponse.bind(this);
    // this.addressAdditionalInformation = this.addressAdditionalInformation.bind(this);
    this.summarizeAdditionalInformation = this.summarizeAdditionalInformation.bind(this);
  }

  // node responsible for routing analysis issue fixes
  // processes input / output to / from analysis fix node
  // glorified for loop in a state machine
  async fixAnalysisIssueRouter(
    state: typeof AnalysisIssueFixOrchestratorState.State,
  ): Promise<typeof AnalysisIssueFixOrchestratorState.State> {
    const nextState: typeof AnalysisIssueFixOrchestratorState.State = {
      ...state,
      // since we are using a reducer, allResponses has to be reset
      outputAllResponses: [],
      outputHints: [],
      inputFileUri: undefined,
      inputFileContent: undefined,
      inputIncidents: [],
    };
    // we have to fix the incidents if there's at least one present in state
    if (state.currentIdx < state.inputIncidentsByUris.length) {
      const nextEntry = state.inputIncidentsByUris[state.currentIdx];
      if (nextEntry) {
        try {
          const cachedContent = await this.fsCache.get(nextEntry.uri);
          if (cachedContent) {
            nextState.inputFileContent = cachedContent;
          }
          const fileContent = await fsPromises.readFile(nextEntry.uri, "utf8");
          nextState.inputFileContent = fileContent;
          nextState.inputFileUri = nextEntry.uri;
          nextState.inputIncidents = nextEntry.incidents;
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

      // Only create solution if all required fields are available
      if (
        this.solutionServerClient &&
        state.inputFileUri &&
        state.inputFileContent &&
        state.outputReasoning &&
        state.inputIncidents.length > 0
      ) {
        const incidentIds = await Promise.all(
          state.inputIncidents.map((incident) =>
            this.solutionServerClient.createIncident(incident),
          ),
        );

        try {
          await this.solutionServerClient.createSolution(
            incidentIds,
            {
              diff: createPatch(
                state.inputFileUri,
                state.inputFileContent,
                state.outputUpdatedFile,
              ),
              before: [
                {
                  uri: state.inputFileUri,
                  content: state.inputFileContent,
                },
              ],
              after: [
                {
                  uri: state.inputFileUri,
                  content: state.outputUpdatedFile,
                },
              ],
            },
            state.outputReasoning,
            state.outputHints || [],
          );
        } catch (error) {
          console.error(`Failed to create solution: ${error}`);
        }
      } else {
        console.error("Missing required fields for solution creation");
      }

      nextState.outputAllResponses = [
        {
          ...state,
        },
      ];
      nextState.outputUpdatedFile = undefined;
      nextState.outputAdditionalInfo = undefined;
      nextState.outputHints = [];
    }
    // if this was the last file we worked on, accumulate additional infromation
    if (state.currentIdx === state.inputIncidentsByUris.length) {
      const accumulated = [...state.outputAllResponses, ...nextState.outputAllResponses].reduce(
        (acc, val) => {
          return {
            reasoning: `${acc.reasoning}\n${val.outputReasoning}`,
            additionalInfo: `${acc.additionalInfo}\n${val.outputAdditionalInfo}`,
            uris: val.outputUpdatedFileUri
              ? acc.uris.concat([relative(this.workspaceDir, val.outputUpdatedFileUri)])
              : acc.uris,
          };
        },
        {
          reasoning: "",
          additionalInfo: "",
          uris: [],
        } as { reasoning: string; additionalInfo: string; uris: string[] },
      );
      nextState.inputAllAdditionalInfo = accumulated.additionalInfo;
      nextState.inputAllReasoning = accumulated.reasoning;
      nextState.inputAllModifiedFiles = accumulated.uris;
    }
    return nextState;
  }

  // node that fixes given analysis issue
  async fixAnalysisIssue(
    state: typeof AnalysisIssueFixInputState.State,
  ): Promise<typeof AnalysisIssueFixOutputState.State> {
    if (!state.inputFileUri || !state.inputFileContent || state.inputIncidents.length === 0) {
      return {
        outputUpdatedFile: undefined,
        outputAdditionalInfo: undefined,
        outputReasoning: undefined,
        outputUpdatedFileUri: state.inputFileUri,
        outputHints: [],
      };
    }

    // Process incidents in a single loop, collecting hints and creating incidents
    const seenViolationTypes = new Set<string>();
    const hints: GetBestHintResult[] = [];

    for (const incident of state.inputIncidents) {
      // Check if we need to get a hint for this violation type
      if (incident.ruleset_name && incident.violation_name) {
        const violationKey = `${incident.ruleset_name}::${incident.violation_name}`;

        if (!seenViolationTypes.has(violationKey)) {
          seenViolationTypes.add(violationKey);
          try {
            const hint = await this.solutionServerClient.getBestHint(
              incident.ruleset_name,
              incident.violation_name,
            );
            if (hint) {
              hints.push(hint);
            }
          } catch (error) {
            console.warn(`Failed to get hint for ${violationKey}: ${error}`);
          }
        }
      }
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
${state.inputIncidents
  .map((incident) => {
    return `* ${incident.lineNumber}: ${incident.message}`;
  })
  .join("\n")}
${hints.length > 0 ? `\n## Hints\n${hints.map((hint) => `* ${hint.hint}`).join("\n")}` : ""}

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
        outputHints: [],
      };
    }

    const { additionalInfo, reasoning, updatedFile } = this.parseAnalysisFixResponse(response);

    return {
      outputReasoning: reasoning,
      outputUpdatedFile: updatedFile,
      outputAdditionalInfo: additionalInfo,
      outputUpdatedFileUri: state.inputFileUri,
      outputHints: hints.map((hint) => hint.hint_id),
    };
  }

  // node that summarizes additional information into actionable items
  // this is needed because when addressing multiple files we may have
  // duplicate changes as well as unnecessary changes mentioned in output
  async summarizeAdditionalInformation(
    state: typeof SummarizeAdditionalInfoInputState.State,
  ): Promise<typeof SummarizeAdditionalInfoOutputState.State> {
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
The notes contain a summary of changes we already made and additional changes that may be required in other files elsewhere in the project.\
They also contain a list of files we changed.
Your task is to carefully analyze the notes, compare them with files that are changed, understand any additional changes needed to complete the migration and provide a concise summary *solely* of the additional changes required elsewhere in the project.\
**It is essential that your summary includes only the additional changes needed. Do not include changes already made.**\
Make sure you output all the details about the changes including any relevant code snippets and instructions.
**Do not omit any additional changes needed.**
If there are no additional changes needed to complete the migration, respond with text "NO-CHANGE".\
Here is the summary: \
${
  state.inputAllReasoning && state.inputAllReasoning.length > 0
    ? `### Summary of changes made\n${state.inputAllReasoning}`
    : ""
}
### Additional information about changes
${state.inputAllAdditionalInfo}
${
  state.inputAllModifiedFiles
    ? `### List of modified files\n${state.inputAllModifiedFiles?.join("\n")}`
    : ""
}
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
    state: typeof SummarizeAdditionalInfoInputState.State,
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
      `During the migration to ${state.migrationHint}, we captured the following notes detailing changes we made to the source code.\
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

  private parseAnalysisFixResponse(response: AIMessage | AIMessageChunk): {
    [key in IssueFixResponseParserState]: string;
  } {
    const parsed: {
      [key in IssueFixResponseParserState]: string;
    } = { updatedFile: "", additionalInfo: "", reasoning: "" };
    const content = typeof response.content === "string" ? response.content : "";

    const matcherFunc = (line: string): IssueFixResponseParserState | undefined =>
      line.match(/(#|\*)* *[R|r]easoning/)
        ? "reasoning"
        : line.match(/(#|\*)* *[U|u]pdated *[F|f]ile/)
          ? "updatedFile"
          : line.match(/(#|\*)* *[A|a]dditional *[I|i]nformation/)
            ? "additionalInfo"
            : undefined;

    let parserState: IssueFixResponseParserState | undefined = undefined;
    let buffer: string[] = [];

    for (const line of content.split("\n")) {
      const nextState = matcherFunc(line);
      if (nextState) {
        if (parserState && buffer.length) {
          parsed[parserState] = buffer.join("\n").trim();
        }
        buffer = [];
        parserState = nextState;
      } else if (parserState !== "updatedFile" || !line.match(/```\w*/)) {
        buffer.push(line);
      }
    }

    if (parserState && buffer.length) {
      parsed[parserState] = buffer.join("\n").trim();
    }

    return parsed;
  }
}
