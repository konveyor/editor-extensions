import { Logger } from "winston";
import { basename, relative } from "path";
import {
  type AIMessage,
  type AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { promises as fsPromises } from "fs";
import { type DynamicStructuredTool } from "@langchain/core/tools";

import { getCacheKey } from "../utils";
import {
  type SummarizeAdditionalInfoInputState,
  type AnalysisIssueFixInputState,
  type AnalysisIssueFixOutputState,
  type AnalysisIssueFixOrchestratorState,
  type SummarizeAdditionalInfoOutputState,
  type SummarizeHistoryOutputState,
} from "../schemas/analysisIssueFix";
import { BaseNode } from "./base";
import { type InMemoryCacheWithRevisions } from "../cache";
import { type KaiModelProvider, KaiWorkflowMessageType } from "../types";
import { type GetBestHintResult, SolutionServerClient } from "../clients/solutionServerClient";

export type IssueFixResponseParserState = "reasoning" | "updatedFile" | "additionalInfo";

export class AnalysisIssueFix extends BaseNode {
  constructor(
    modelProvider: KaiModelProvider,
    tools: DynamicStructuredTool[],
    private readonly fsCache: InMemoryCacheWithRevisions<string, string>,
    private readonly workspaceDir: string,
    private readonly solutionServerClient: SolutionServerClient,
    private readonly logger: Logger,
  ) {
    super("AnalysisIssueFix", modelProvider, tools);

    this.fixAnalysisIssue = this.fixAnalysisIssue.bind(this);
    this.summarizeHistory = this.summarizeHistory.bind(this);
    this.fixAnalysisIssueRouter = this.fixAnalysisIssueRouter.bind(this);
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
    this.logger.silly("AnalysisIssueFixRouter called with state", { state });
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
          this.logger.error("Failed to read input file", nextEntry.uri);
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
            [
              {
                uri: state.inputFileUri,
                content: state.inputFileContent,
              },
            ],
            [
              {
                uri: state.inputFileUri,
                content: state.outputUpdatedFile,
              },
            ],
            state.outputReasoning,
            state.outputHints || [],
          );
        } catch (error) {
          this.logger.error(`Failed to create solution: ${error}`);
        }
      } else {
        this.logger.error("Missing required fields for solution creation");
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
            reasoning: `${acc.reasoning}\n\n\n#### Changes made in ${relative(this.workspaceDir, val.outputUpdatedFileUri ?? "")}\n\n${val.outputReasoning}`,
            additionalInfo: `${acc.additionalInfo}\n\n\n#### Additional changes from ${relative(this.workspaceDir, val.outputUpdatedFileUri ?? "")}\n\n${val.outputAdditionalInfo}`,
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
    this.logger.silly("AnalysisIssueFixRouter returning nextState", { nextState });
    return nextState;
  }

  // node that fixes given analysis issue
  async fixAnalysisIssue(
    state: typeof AnalysisIssueFixInputState.State,
  ): Promise<typeof AnalysisIssueFixOutputState.State> {
    this.logger.silly("AnalysisIssueFix called with state", { state });
    if (!state.inputFileUri || !state.inputFileContent || state.inputIncidents.length === 0) {
      return {
        outputUpdatedFile: undefined,
        outputAdditionalInfo: undefined,
        outputReasoning: undefined,
        outputUpdatedFileUri: state.inputFileUri,
        outputHints: [],
        iterationCount: state.iterationCount,
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
            this.logger.warn(`Failed to get hint for ${violationKey}: ${error}`);
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
    return `* ${incident.message}`;
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

    console.debug(humanMessage.content);
    const response = await this.streamOrInvoke(
      [sysMessage, humanMessage],
      {
        emitResponseChunks: true,
        enableTools: false,
      },
      {
        cacheKey: getCacheKey(state),
      },
    );

    if (!response) {
      this.logger.silly("AnalysisIssueFix returned undefined response");
      return {
        outputAdditionalInfo: undefined,
        outputUpdatedFile: undefined,
        outputReasoning: undefined,
        outputUpdatedFileUri: state.inputFileUri,
        outputHints: [],
        iterationCount: state.iterationCount,
      };
    }

    const { additionalInfo, reasoning, updatedFile } = parseAnalysisFixResponse(response);

    return {
      outputReasoning: reasoning,
      outputUpdatedFile: updatedFile,
      outputAdditionalInfo: additionalInfo,
      outputUpdatedFileUri: state.inputFileUri,
      outputHints: hints.map((hint) => hint.hint_id),
      iterationCount: state.iterationCount + 1,
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
      `You are an experienced ${state.programmingLanguage} programmer, specializing in migrating source code to ${state.migrationHint}. Your job is to read migration notes and output only the additional changes that are still needed elsewhere in the project.`,
    );
    const human_message = new HumanMessage(
      `During the migration to ${state.migrationHint}, we captured notes that include:
- A list of files we modified
- Reasoning behind changes made to existing files
- Additional information that may contain even more changes needed

* Your task:
Carefully analyze the reasoning and additional information for each file, and determine if there are any additional changes needed to complete the migration. \
Provide a concise summary *solely* of the additional changes required elsewhere in the project. \
**It is essential that your summary includes only the additional changes needed. Do not include changes already made.** \
Make sure you output all the details about the changes including any relevant code snippets and instructions.
**Do not omit any additional changes needed. Be exhaustive and specific.**

* Rules:
- Only the files listed under MODIFIED_FILES are already changed. Any file **not** in MODIFIED_FILES is unmodified.
- Treat sections named “Summary of changes made” as implemented changes only for the files listed in MODIFIED_FILES.
- Treat “Additional information / notes / rationale” as proposed work, not-yet-applied.
- If there are no additional changes needed, respond with exactly:
NO-CHANGE: <one-sentence reason>

Here is your input:

${
  state.inputAllModifiedFiles
    ? `### MODIFIED_FILES\n\n${state.inputAllModifiedFiles?.join("\n")}`
    : ""
}

${
  state.inputAllReasoning && state.inputAllReasoning.length > 0
    ? `### Summary of changes made\n\n${state.inputAllReasoning}`
    : ""
}

### Additional information about changes

${state.inputAllAdditionalInfo}
`,
    );

    const response = await this.streamOrInvoke(
      [sys_message, human_message],
      {
        // this is basically thinking part, we
        // don't want to share with user this part
        emitResponseChunks: false,
        enableTools: false,
      },
      {
        cacheKey: getCacheKey(state, "AdditionalInfo"),
      },
    );

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
        iterationCount: state.iterationCount,
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

    const response = await this.streamOrInvoke(
      [sys_message, human_message],
      {
        emitResponseChunks: false,
        enableTools: false,
      },
      {
        cacheKey: getCacheKey(state, "History"),
      },
    );

    if (!response) {
      return {
        summarizedHistory: "",
        iterationCount: state.iterationCount,
      };
    }

    return {
      summarizedHistory: this.aiMessageToString(response),
      iterationCount: state.iterationCount + 2, // since these steps happen in parallel, we increment by 2
    };
  }
}

export function parseAnalysisFixResponse(response: AIMessage | AIMessageChunk): {
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

  const processBuffer = (buffer: string[], parserState: IssueFixResponseParserState): string => {
    if (parserState === "updatedFile") {
      // ISSUE-848: anything before and after the first and last code block separator should be omitted
      const firstCodeBlockSeparatorIndex = buffer.findIndex((line) => line.match(/^\s*```\w*/));
      const lastCodeBlockSeparatorIndex = buffer.findLastIndex((line) => line.match(/^\s*```\w*/));
      return buffer
        .slice(
          firstCodeBlockSeparatorIndex !== -1 ? firstCodeBlockSeparatorIndex + 1 : 0,
          lastCodeBlockSeparatorIndex !== -1 ? lastCodeBlockSeparatorIndex : buffer.length,
        )
        .join("\n")
        .trim();
    } else {
      return buffer.join("\n").trim();
    }
  };

  let parserState: IssueFixResponseParserState | undefined = undefined;
  let buffer: string[] = [];

  for (const line of content.split("\n")) {
    const nextState = matcherFunc(line);
    if (nextState) {
      if (parserState && buffer.length) {
        parsed[parserState] = processBuffer(buffer, parserState);
      }
      buffer = [];
      parserState = nextState;
    } else {
      buffer.push(line);
    }
  }

  if (parserState && buffer.length) {
    parsed[parserState] = processBuffer(buffer, parserState);
  }

  return parsed;
}
