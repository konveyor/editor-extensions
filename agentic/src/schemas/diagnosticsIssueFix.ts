import { Annotation } from "@langchain/langgraph";

import { BaseInputMetaState } from "./base";

// input state for node that plans the fixes for given diagnostics issues
export const DiagnosticsPlannerInputState = Annotation.Root({
  ...BaseInputMetaState.spec,
  // summarized history of analysis fixes other agent made
  history: Annotation<string>,
  // list of diagnostics issues to fix
  tasks: Annotation<string[]>,
  // list of known agents the planner can delegate tasks to
  agents: Annotation<
    {
      name: string;
      description: string;
    }[]
  >,
});

// output state for the planner node
export const DiagnosticsPlannerOutputState = Annotation.Root({
  agents: Annotation<
    {
      name: string;
      instructions: string;
    }[]
  >,
});

// overall state for the graph
export const DiagnosticsOverallState = Annotation.Root({
  ...DiagnosticsPlannerInputState.spec,
  ...DiagnosticsPlannerOutputState.spec,
});
