import { EnhancedIncident } from "@editor-extensions/shared";
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

import { BaseInputMetaState } from "./base";
import { type KaiModifiedFile } from "../types";

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
  inputIncidentsDescription: Annotation<string | undefined>,
});

// output state for node that fixes an analysis issue
export const AnalysisIssueFixOutputState = Annotation.Root({
  outputUpdatedFileUri: Annotation<string | undefined>,
  outputUpdatedFile: Annotation<string | undefined>,
  outputAdditionalInfo: Annotation<string | undefined>,
  outputReasoning: Annotation<string | undefined>,
});

// input state for nodes that summarize changes made so far and also outline additional info to address
export const AnalysisFixSummarizeInputState = Annotation.Root({
  ...BaseInputMetaState.spec,
  // accumulated response from analysis fix that contains only
  // the additional info
  inputAllAdditionalInfo: Annotation<string | undefined>,
  inputAllReasoning: Annotation<string | undefined>,
  inputAllFileUris: Annotation<string[] | undefined>,
});

// router state for the analysis issue fix sub-flow.
// this is what's responsible for accumulating analysis state
// over multiple file fixes and determining when to move onto
// the next agent
export const AnalysisIssueFixRouterState = Annotation.Root({
  ...AnalysisIssueFixInputState.spec,
  ...AnalysisIssueFixOutputState.spec,
  ...AnalysisFixSummarizeInputState.spec,
  // this is the accumulated responses from analysis fix
  // later used for history / background and additional information
  outputAllResponses: Annotation<(typeof AnalysisIssueFixOutputState.State)[]>({
    reducer: arrayReducer,
    default: () => [],
  }),
  // this is the input incidents
  inputIncidentsByUris: Annotation<{ uri: string; incidents: EnhancedIncident[] }[]>,
  // keeps track of which file we are working on for analysis fixes
  currentIdx: Annotation<number>,
});

// output state for node that summarizes additional information
export const AdditionalInfoSummarizeOutputState = Annotation.Root({
  summarizedAdditionalInfo: Annotation<string>,
});

// output state for node that summarizes changes done so far into history
export const SummarizeHistoryOutputState = Annotation.Root({
  summarizedHistory: Annotation<string>,
});

// input state for node that acts on the additional information
export const AddressAdditionalInfoInputState = Annotation.Root({
  ...MessagesAnnotation.spec,
  ...BaseInputMetaState.spec,
  ...AdditionalInfoSummarizeOutputState.spec,
});

// output state for node that acts on the additional information
export const AddressAdditionalInfoOutputState = Annotation.Root({
  ...MessagesAnnotation.spec,
  outputModifiedFiles: Annotation<KaiModifiedFile[]>({
    reducer: arrayReducer,
    default: () => [],
  }),
});

// combined state of the whole graph
export const AnalysisIssueFixOverallState = Annotation.Root({
  ...AnalysisIssueFixRouterState.spec,
  ...AnalysisFixSummarizeInputState.spec,
  ...AdditionalInfoSummarizeOutputState.spec,
  ...SummarizeHistoryOutputState.spec,
  ...AddressAdditionalInfoInputState.spec,
  ...AddressAdditionalInfoOutputState.spec,
});
