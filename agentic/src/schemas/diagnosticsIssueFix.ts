import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

import { type KaiModifiedFile } from "../types";
import { BaseInputMetaState, BaseOutputMetaState } from "./base";

// different types of agents available
export type AgentName = "generalFix" | "javaDependency" | "properties";

// input state for node that plans the fixes for given diagnostics issues
export const DiagnosticsPlannerInputState = Annotation.Root({
  ...BaseInputMetaState.spec,
  // summarized history of analysis fixes other agent made
  plannerInputBackground: Annotation<string>,
  // list of diagnostics issues to fix
  plannerInputTasks: Annotation<{ uri: string; tasks: string[] } | undefined>,
  // list of known agents the planner can delegate tasks to
  plannerInputAgents: Annotation<Array<AgentName>>,
});

// output state for the planner node
export const DiagnosticsPlannerOutputState = Annotation.Root({
  ...BaseOutputMetaState.spec,
  // list of agents and detailed instructions for them to work issues
  plannerOutputNominatedAgents: Annotation<
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
  inputUrisForGeneralFix: Annotation<Array<string> | undefined>,
});

// output state for the node that fixes general issues
export const GeneralIssueFixOutputState = Annotation.Root({
  ...BaseOutputMetaState.spec,
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
