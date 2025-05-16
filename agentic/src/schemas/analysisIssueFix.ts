import { EnhancedIncident } from "@editor-extensions/shared";
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

import { type KaiModifiedFile } from "../types";

const arrayReducer = <T>(left: T[], right: T | T[]): T[] => {
  if (Array.isArray(right)) {
    return left.concat(right);
  }
  return left.concat([right]);
};

// common state composed in input states of all nodes
export const AnalysisIssueFixInputMetaState = Annotation.Root({
  migrationHint: Annotation<string>,
  programmingLanguage: Annotation<string>,
});

// input state for node that fixes an analysis issue
// it only ever knows about one file and issues in it
export const AnalysisIssueFixInputState = Annotation.Root({
  ...AnalysisIssueFixInputMetaState.spec,
  fileUri: Annotation<string | undefined>,
  fileContent: Annotation<string | undefined>,
  incidentsDescription: Annotation<string | undefined>,
});

// output state for node that fixes an analysis issue
export const AnalysisIssueFixOutputState = Annotation.Root({
  response: Annotation<string | undefined>,
});

// input state for node that summarizes additional information from responses of analysis issue node
export const AdditionalInfoSummarizeInputState = Annotation.Root({
  ...AnalysisIssueFixInputMetaState.spec,
  previousResponse: Annotation<string | undefined>,
});

// router state for the analysis issue fix sub-flow.
// this is what's responsible for accumulating analysis state
// over multiple file fixes and determining when to move onto
// the next agent
export const AnalysisIssueFixRouterState = Annotation.Root({
  ...AnalysisIssueFixInputState.spec,
  ...AnalysisIssueFixOutputState.spec,
  ...AdditionalInfoSummarizeInputState.spec,
  allResponses: Annotation<string[]>({
    reducer: arrayReducer,
    default: () => [],
  }),
  incidentsByUris: Annotation<{ uri: string; incidents: EnhancedIncident[] }[]>,
  currentIdx: Annotation<number>,
});

// output state for node that summarizes additional information
export const AdditionalInfoSummarizeOutputState = Annotation.Root({
  additionalInformation: Annotation<string>,
});

// input state for node that acts on the additional information
export const AddressAdditionalInfoInputState = Annotation.Root({
  ...MessagesAnnotation.spec,
  ...AnalysisIssueFixInputMetaState.spec,
  ...AdditionalInfoSummarizeOutputState.spec,
});

// output state for node that acts on the additional information
export const AddressAdditionalInfoOutputState = Annotation.Root({
  ...MessagesAnnotation.spec,
  modifiedFiles: Annotation<KaiModifiedFile[]>({
    reducer: arrayReducer,
    default: () => [],
  }),
});

// combined state of the whole graph
export const AnalysisIssueFixOverallState = Annotation.Root({
  ...AnalysisIssueFixRouterState.spec,
  ...AdditionalInfoSummarizeInputState.spec,
  ...AdditionalInfoSummarizeOutputState.spec,
  ...AddressAdditionalInfoInputState.spec,
  ...AddressAdditionalInfoOutputState.spec,
});
