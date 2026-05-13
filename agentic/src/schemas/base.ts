import { Annotation } from "@langchain/langgraph";

// common state composed in input states of all nodes
export const BaseInputMetaState = Annotation.Root({
  migrationHint: Annotation<string>,
  programmingLanguage: Annotation<string>,
  // this is the subdirectory in the cache dir where the cache files are stored for a given run
  cacheSubDir: Annotation<string>,
  // total number of iterations so far, used for tracking and creating a cache key
  iterationCount: Annotation<number>,
});

export const BaseOutputMetaState = Annotation.Root({
  iterationCount: Annotation<number>,
});
