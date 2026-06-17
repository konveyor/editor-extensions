import { END } from "@langchain/langgraph";
import * as winston from "winston";

import { KaiInteractiveWorkflow } from "../src/workflows/interactiveWorkflow";
import { type AnalysisIssueFixOrchestratorState } from "../src/schemas/analysisIssueFix";

function makeWorkflow(): KaiInteractiveWorkflow {
  const logger = winston.createLogger({
    level: "error",
    format: winston.format.json(),
    transports: [new winston.transports.Console({ silent: true })],
  });
  return new KaiInteractiveWorkflow(logger);
}

function baseState(): typeof AnalysisIssueFixOrchestratorState.State {
  return {
    inputIncidentsByUris: [
      { uri: "/work/A.java", incidents: [] },
      { uri: "/work/B.java", incidents: [] },
    ],
    currentIdx: 2,
    enableAdditionalInformation: true,
    migrationHint: "",
    programmingLanguage: "java",
    cacheSubDir: "",
    iterationCount: 0,
    inputFileContent: undefined,
    inputFileUri: undefined,
    inputIncidents: [],
    inputAllAdditionalInfo: undefined,
    inputAllReasoning: undefined,
    inputAllModifiedFiles: [],
    outputAdditionalInfo: undefined,
    outputReasoning: undefined,
    outputUpdatedFile: undefined,
    outputUpdatedFileUri: undefined,
    outputHints: [],
    outputAllResponses: [],
  };
}

describe("analysisIssueFixRouterEdge (issue #1418)", () => {
  it("returns END when all incidents are processed and nothing was accumulated", async () => {
    const wf = makeWorkflow();
    expect(await wf.analysisIssueFixRouterEdge(baseState())).toBe(END);
  });

  it("loops back to the router when incidents remain", async () => {
    const wf = makeWorkflow();
    const state = baseState();
    state.currentIdx = 1;
    expect(await wf.analysisIssueFixRouterEdge(state)).toBe("fix_analysis_issue_router");
  });

  it("routes to summarize when additional information was accumulated", async () => {
    const wf = makeWorkflow();
    const state = baseState();
    state.inputAllAdditionalInfo = "info";
    state.inputAllReasoning = "reasoning";
    expect(await wf.analysisIssueFixRouterEdge(state)).toEqual([
      "summarize_additional_information",
      "summarize_history",
    ]);
  });
});
