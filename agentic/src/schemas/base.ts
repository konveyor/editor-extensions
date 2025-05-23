import { Annotation } from "@langchain/langgraph";

// common state composed in input states of all nodes
export const BaseInputMetaState = Annotation.Root({
  migrationHint: Annotation<string>,
  programmingLanguage: Annotation<string>,
});
