import { Logger } from "winston";
import { basename } from "path";
import {
  type AIMessage,
  type AIMessageChunk,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { promises as fsPromises } from "fs";
import { type DynamicStructuredTool } from "@langchain/core/tools";
import { renderPrompt } from "@editor-extensions/prompts";

import { getCacheKey, toPosixRelative } from "../utils";
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
    private readonly solutionServerClient: SolutionServerClient | undefined,
    logger: Logger,
  ) {
    super("AnalysisIssueFix", modelProvider, tools, logger);

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
    // Don't log full state - can cause "Invalid string length" error with large states
    this.logger.silly("AnalysisIssueFixRouter called", {
      currentIdx: state.currentIdx,
      totalIncidents: state.inputIncidentsByUris.length,
    });
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
        const solutionServerClient = this.solutionServerClient;

        const incidentIds = await Promise.all(
          state.inputIncidents.map((incident) => solutionServerClient.createIncident(incident)),
        );

        try {
          await solutionServerClient.createSolution(
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
          const rel = toPosixRelative(this.workspaceDir, val.outputUpdatedFileUri ?? "");
          return {
            reasoning: `${acc.reasoning}\n\n\n#### Changes made in ${rel}\n\n${val.outputReasoning}`,
            additionalInfo: `${acc.additionalInfo}\n\n\n#### Additional changes from ${rel}\n\n${val.outputAdditionalInfo}`,
            uris: val.outputUpdatedFileUri ? acc.uris.concat([rel]) : acc.uris,
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
    // Don't log full state - can cause "Invalid string length" error
    this.logger.silly("AnalysisIssueFixRouter returning", {
      hasOutputAllResponses: !!nextState.outputAllResponses,
      responseCount: nextState.outputAllResponses?.length || 0,
    });
    return nextState;
  }

  // node that fixes given analysis issue
  async fixAnalysisIssue(
    state: typeof AnalysisIssueFixInputState.State,
  ): Promise<typeof AnalysisIssueFixOutputState.State> {
    // Don't log full state - can cause "Invalid string length" error
    this.logger.silly("AnalysisIssueFix called", {
      hasInputFileUri: !!state.inputFileUri,
      hasInputFileContent: !!state.inputFileContent,
      incidentCount: state.inputIncidents?.length || 0,
    });
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
            if (!this.solutionServerClient) {
              this.logger.info("Solution server client not available, skipping hint retrieval");
              continue;
            }
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
      renderPrompt("agentic.analysis.fix-issue.system", {
        programmingLanguage: state.programmingLanguage,
        migrationHint: state.migrationHint,
      }),
    );

    const humanMessage = new HumanMessage(
      renderPrompt("agentic.analysis.fix-issue.human", {
        programmingLanguage: state.programmingLanguage,
        migrationHint: state.migrationHint,
        fileName,
        inputFileContent: state.inputFileContent,
        inputIncidents: state.inputIncidents,
        hints,
      }),
    );

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
      this.logger.warn(
        `AnalysisIssueFix: LLM returned no response for file "${fileName}". ` +
          `This may indicate a model provider configuration issue.`,
      );
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
      renderPrompt("agentic.analysis.summarize-additional-info.system", {
        programmingLanguage: state.programmingLanguage,
        migrationHint: state.migrationHint,
      }),
    );
    const human_message = new HumanMessage(
      renderPrompt("agentic.analysis.summarize-additional-info.human", {
        migrationHint: state.migrationHint,
        inputAllModifiedFiles: state.inputAllModifiedFiles,
        inputAllReasoning: state.inputAllReasoning,
        inputAllAdditionalInfo: state.inputAllAdditionalInfo,
      }),
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
      renderPrompt("agentic.analysis.summarize-history.system", {
        programmingLanguage: state.programmingLanguage,
        migrationHint: state.migrationHint,
      }),
    );
    const human_message = new HumanMessage(
      renderPrompt("agentic.analysis.summarize-history.human", {
        migrationHint: state.migrationHint,
        inputAllReasoning: state.inputAllReasoning,
      }),
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
      this.logger.warn(
        "SummarizeHistory: LLM returned no response. This may indicate a model provider configuration issue.",
      );
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
