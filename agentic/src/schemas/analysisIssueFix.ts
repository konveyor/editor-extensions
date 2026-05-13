import { Annotation } from "@langchain/langgraph";
import { EnhancedIncident } from "@editor-extensions/shared";

import { BaseInputMetaState, BaseOutputMetaState } from "./base";

const arrayReducer = <T>(left: T[], right: T | T[]): T[] => {
  if (Array.isArray(right)) {
    return left.concat(right);
  }
  return left.concat([right]);
};

// input state for node that fixes an analysis issue
// it only ever knows about one file and issues in it
export const AnalysisIssueFixInputState = Annotation.Root({
  ...BaseInputMetaState.spec,
  inputFileUri: Annotation<string | undefined>,
  inputFileContent: Annotation<string | undefined>,
  inputIncidents: Annotation<Array<EnhancedIncident>>,
});

// output state for node that fixes an analysis issue
export const AnalysisIssueFixOutputState = Annotation.Root({
  ...BaseOutputMetaState.spec,
  outputUpdatedFileUri: Annotation<string | undefined>,
  outputUpdatedFile: Annotation<string | undefined>,
  outputAdditionalInfo: Annotation<string | undefined>,
  outputReasoning: Annotation<string | undefined>,
  outputHints: Annotation<Array<number>>,
});

// input state for nodes that summarize changes made so far and also outline additional info to address
export const SummarizeAdditionalInfoInputState = Annotation.Root({
  ...BaseInputMetaState.spec,
  // accumulated response from analysis fix that contains only
  // the additional info
  inputAllAdditionalInfo: Annotation<string | undefined>,
  inputAllReasoning: Annotation<string | undefined>,
  inputAllModifiedFiles: Annotation<Array<string>>,
});

// orchestrator state for the analysis issue fix sub-flow.
// this is what's responsible for accumulating analysis state
// over multiple file fixes and determining when to move onto
// the next agent
export const AnalysisIssueFixOrchestratorState = Annotation.Root({
  ...AnalysisIssueFixInputState.spec,
  ...AnalysisIssueFixOutputState.spec,
  ...SummarizeAdditionalInfoInputState.spec,
  // this is the accumulated responses from analysis fix
  // later used for history / background and additional information
  outputAllResponses: Annotation<Array<typeof AnalysisIssueFixOutputState.State>>({
    reducer: arrayReducer,
    default: () => [],
  }),
  // this is the input incidents
  inputIncidentsByUris: Annotation<Array<{ uri: string; incidents: Array<EnhancedIncident> }>>,
  // keeps track of which file we are working on for analysis fixes
  currentIdx: Annotation<number>,
  enableAdditionalInformation: Annotation<boolean>,
});

// output state for node that summarizes additional information
export const SummarizeAdditionalInfoOutputState = Annotation.Root({
  summarizedAdditionalInfo: Annotation<string>,
});

// output state for node that summarizes changes done so far into history
export const SummarizeHistoryOutputState = Annotation.Root({
  ...BaseOutputMetaState.spec,
  summarizedHistory: Annotation<string>,
});
