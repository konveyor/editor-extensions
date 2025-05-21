import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

import { BaseInputMetaState } from "./base";
import { type KaiModifiedFile } from "../types";

// input state for node that plans the fixes for given diagnostics issues
export const DiagnosticsPlannerInputState = Annotation.Root({
  ...BaseInputMetaState.spec,
  // summarized history of analysis fixes other agent made
  plannerInputBackground: Annotation<string>,
  // list of diagnostics issues to fix
  plannerInputTasks: Annotation<Array<string> | undefined>,
  // list of known agents the planner can delegate tasks to
  plannerInputAgents: Annotation<
    Array<{
      name: string;
      description: string;
    }>
  >,
});

// output state for the planner node
export const DiagnosticsPlannerOutputState = Annotation.Root({
  // list of agents and detailed instructions for them to work issues
  outputNominatedAgents: Annotation<
    | Array<{
        name: string;
        instructions: string;
      }>
    | undefined
  >,
});

// input state for the node that fixes general issues
export const GeneralIssueFixInputState = Annotation.Root({
  ...BaseInputMetaState.spec,
  ...MessagesAnnotation.spec,
  inputInstructionsForGeneralFix: Annotation<string | undefined>,
});

// output state for the node that fixes general issues
export const GeneralIssueFixOutputState = Annotation.Root({
  ...MessagesAnnotation.spec,
  outputModifiedFilesFromGeneralFix: Annotation<Array<KaiModifiedFile> | undefined>,
});

// state for the orchestrator node that manages input / output from different nodes
export const DiagnosticsOrchestratorState = Annotation.Root({
  ...DiagnosticsPlannerInputState.spec,
  ...DiagnosticsPlannerOutputState.spec,
  ...GeneralIssueFixInputState.spec,
  ...GeneralIssueFixOutputState.spec,
  // summarized additional info spit by analysis fix workflow
  inputSummarizedAdditionalInfo: Annotation<string | undefined>,
  // diagnostics tasks sent by the ide
  inputDiagnosticsTasks: Annotation<Array<{ uri: string; tasks: string[] }> | undefined>,
  // internal fields indicating the current task we are processing and the agent chosen
  currentTask: Annotation<{ uri: string; tasks: Array<string> } | undefined>,
  currentAgent: Annotation<string | undefined>,
  // internal field determining when to exit, set when user declines diagnostics fixes
  shouldEnd: Annotation<boolean>,
  enableDiagnosticsFixes: Annotation<boolean>,
});
