import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

import { KaiModifiedFile } from "../types";

const arrayReducer = <T>(left: T[], right: T | T[]): T[] => {
  if (Array.isArray(right)) {
    return left.concat(right);
  }
  return left.concat([right]);
};

export const AnalysisIssueFixInputState = Annotation.Root({
  previousResponse: Annotation<string>,
  additionalInformation: Annotation<string>,
  migrationHint: Annotation<string>,
  programmingLanguage: Annotation<string>,
});

export const AnalysisIssueFixOutputState = Annotation.Root({
  ...MessagesAnnotation.spec,
  modifiedFiles: Annotation<KaiModifiedFile[]>({
    reducer: arrayReducer,
    default: () => [],
  }),
});

export const AnalysisIssueFixState = Annotation.Root({
  ...AnalysisIssueFixInputState.spec,
  ...AnalysisIssueFixOutputState.spec,
});
