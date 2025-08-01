import * as pathlib from "path";
import {
  type AIMessageChunk,
  AIMessage,
  type BaseMessage,
  SystemMessage,
  HumanMessage,
  RemoveMessage,
} from "@langchain/core/messages";
import { type DynamicStructuredTool } from "@langchain/core/tools";

import { getCacheKey } from "../utils";
import {
  type KaiModelProvider,
  type KaiUserInteractionMessage,
  KaiWorkflowMessageType,
  type PendingUserInteraction,
} from "../types";
import { BaseNode } from "./base";
import {
  type AgentName,
  type DiagnosticsPlannerInputState,
  type DiagnosticsPlannerOutputState,
  type DiagnosticsOrchestratorState,
  type GeneralIssueFixInputState,
  type GeneralIssueFixOutputState,
} from "../schemas/diagnosticsIssueFix";

type PlannerResponseParserState = "name" | "instructions";

export class DiagnosticsIssueFix extends BaseNode {
  private readonly diagnosticsPromises: Map<string, PendingUserInteraction>;

  static readonly SubAgents: { [key in AgentName]?: string } = {
    generalFix: "Fixes general issues, use when no other specialized agent is available",
    javaDependency: "Adds, removes or updates dependencies in a pom.xml file",
  } as const;

  constructor(
    modelProvider: KaiModelProvider,
    fsTools: DynamicStructuredTool[],
    dependencyTools: DynamicStructuredTool[],
    private readonly workspaceDir: string,
  ) {
    super("DiagnosticsIssueFix", modelProvider, [...fsTools, ...dependencyTools]);
    this.diagnosticsPromises = new Map<string, PendingUserInteraction>();

    this.planFixes = this.planFixes.bind(this);
    this.fixGeneralIssues = this.fixGeneralIssues.bind(this);
    this.parsePlannerResponse = this.parsePlannerResponse.bind(this);
    this.fixJavaDependencyIssues = this.fixJavaDependencyIssues.bind(this);
    this.resolveDiagnosticsPromise = this.resolveDiagnosticsPromise.bind(this);
    this.orchestratePlanAndExecution = this.orchestratePlanAndExecution.bind(this);
  }

  // resolves diagnostics promises with tasks or otherwise based on user response
  async resolveDiagnosticsPromise(response: KaiUserInteractionMessage): Promise<void> {
    const promise = this.diagnosticsPromises.get(response.id);
    if (!promise) {
      return;
    }
    const { data } = response;
    if (!data.response || (!data.response.choice && data.response.yesNo === undefined)) {
      promise.reject(Error(`Invalid response from user`));
    }
    promise.resolve(response);
  }

  // node responsible for orchestrating planning work and calling nodes - we either get diagnostics issues
  // or additional information from previous analysis nodes, if none are present, we wait for diagnostics
  // issues to be submitted by the ide
  async orchestratePlanAndExecution(
    state: typeof DiagnosticsOrchestratorState.State,
  ): Promise<typeof DiagnosticsOrchestratorState.State> {
    const nextState: typeof DiagnosticsOrchestratorState.State = { ...state, shouldEnd: false };
    // if there is already an agent we sent work to, process their outputs and reset state
    if (state.currentAgent) {
      switch (state.currentAgent as AgentName) {
        case "generalFix":
        case "javaDependency":
          nextState.inputInstructionsForGeneralFix = undefined;
          nextState.messages = state.messages.map((m) => new RemoveMessage({ id: m.id! }));
          break;
      }
      nextState.currentAgent = undefined;
      nextState.currentTask = undefined;
    }
    // when there is nothing to work on, wait for diagnostics information
    if (
      (!state.inputDiagnosticsTasks || !state.inputDiagnosticsTasks.length) &&
      !state.inputSummarizedAdditionalInfo &&
      (!state.plannerOutputNominatedAgents || !state.plannerOutputNominatedAgents.length)
    ) {
      nextState.shouldEnd = true;
      // if diagnostic fixes is disabled, end here
      if (!state.enableDiagnosticsFixes) {
        return nextState;
      }
      const id = `req-tasks-${Date.now()}`;
      // ide is expected to resolve this promise when new diagnostics info is available
      const ideDiagnosticsPromise = new Promise<KaiUserInteractionMessage>((resolve, reject) => {
        this.diagnosticsPromises.set(id, {
          resolve,
          reject,
        });
      });
      // this message indicates the IDE that we are waiting
      this.emitWorkflowMessage({
        id,
        type: KaiWorkflowMessageType.UserInteraction,
        data: {
          type: "tasks",
          systemMessage: {},
        },
      });
      try {
        const response = await ideDiagnosticsPromise;
        if (response.data.response?.tasks && response.data.response.yesNo) {
          nextState.shouldEnd = false;
          // group tasks by uris
          const newTasks: { uri: string; tasks: string[] }[] =
            response.data.response.tasks
              ?.reduce(
                (acc, val) => {
                  const existing = acc.find((entry) => entry.uri === val.uri);
                  if (existing) {
                    existing.tasks.push(val.task);
                  } else {
                    acc.push({ uri: val.uri, tasks: [val.task] });
                  }
                  return acc;
                },
                [] as Array<{ uri: string; tasks: string[] }>,
              )
              .map((group) => ({
                ...group,
                tasks: group.tasks.sort(),
              }))
              .sort((a, b) => a.uri.localeCompare(b.uri)) ?? [];
          if (!newTasks || newTasks.length < 1) {
            nextState.shouldEnd = true;
          }
          nextState.inputDiagnosticsTasks = newTasks;
        }
      } catch (e) {
        console.log(`Failed to wait for user response - ${e}`);
      } finally {
        this.diagnosticsPromises.delete(id);
      }
      return nextState;
    }
    // if there are any tasks left that planner already gave us, finish that work first
    if (state.plannerOutputNominatedAgents && state.plannerOutputNominatedAgents.length) {
      const nextSelection = state.plannerOutputNominatedAgents.pop();
      if (nextSelection) {
        const { name, instructions } = nextSelection;
        switch (name as AgentName) {
          case "generalFix":
          case "javaDependency":
            nextState.inputInstructionsForGeneralFix = instructions;
            nextState.inputUrisForGeneralFix =
              state.currentTask && state.currentTask.uri
                ? [pathlib.relative(this.workspaceDir, state.currentTask.uri)]
                : undefined;
            nextState.currentAgent = name;
            break;
          default:
            nextState.currentAgent = undefined;
            break;
        }
      }
      nextState.plannerOutputNominatedAgents = state.plannerOutputNominatedAgents || undefined;
      return nextState;
    }
    // if we are here, there are tasks that need to be planned
    // if its additional information, it will be handled first
    if (state.inputSummarizedAdditionalInfo) {
      nextState.currentTask = {
        uri: "",
        tasks: [state.inputSummarizedAdditionalInfo],
      };
      nextState.plannerInputTasks = nextState.currentTask;
      nextState.inputSummarizedAdditionalInfo = undefined;
    } else if (state.inputDiagnosticsTasks) {
      // pick the next task from the list
      nextState.currentTask = state.inputDiagnosticsTasks.pop();
      nextState.plannerInputTasks = nextState.currentTask;
      nextState.inputDiagnosticsTasks = state.inputDiagnosticsTasks;
    }
    return nextState;
  }

  // node responsible for determining which nodes to delegate work to
  // knows about changes made so far, outputs instructions for the node
  async planFixes(
    state: typeof DiagnosticsPlannerInputState.State,
  ): Promise<typeof DiagnosticsPlannerOutputState.State> {
    if (
      !state.plannerInputTasks ||
      !state.plannerInputTasks.tasks ||
      !state.plannerInputTasks.tasks.length
    ) {
      return {
        plannerOutputNominatedAgents: [],
        iterationCount: state.iterationCount,
      };
    }

    const sys_message = new SystemMessage(
      `You are an experienced architect overlooking migration of a ${state.programmingLanguage} application from ${state.migrationHint}. Your expertise lies in efficiently delegating tasks to the most appropriate specialist to ensure optimal problem resolution.`,
    );

    let agentDescriptions = "";
    state.plannerInputAgents.forEach((a) => {
      agentDescriptions += `\n-\tName: ${a}\tDescription: ${DiagnosticsIssueFix.SubAgents[a]}`;
    });

    const human_message =
      new HumanMessage(`You have a roster of specialized agents at your disposal, each with unique capabilities and areas of focus.\
For context, you are also given background information on changes we made so far to migrate the application.\

**Here is the list of available agents, along with their descriptions:**
${agentDescriptions}

${
  state.plannerInputTasks.uri
    ? `** File in which issues were found: ${state.plannerInputTasks.uri}.
Make sure your instructions are specific to fixing issues in this file.`
    : ""
}

**Here is the list of issues that need to be solved:**
- ${state.plannerInputTasks.tasks.join("\n - ")}

**Previous context about migration**
${state.plannerInputBackground}

Your primary task is to carefully analyze **each individual issue** in the list.\
For each issue, you must determine the most suitable specialized agent to address it.\
You should group related issues that can be efficiently solved by the same agent, ensuring the **most specific agent** is chosen for the grouped issues.
If an an issue, or a group of issues, requires a different specialist, you **must** create a new delegation block for that specialist.
Your instructions to each agent must be specific, clear, and tailored to their expertise, detailing how they should approach and solve the assigned problems.\
**Make sure** your instructions take into account previous changes we made for migrating the project and align with the overall migration effort.\
Consider the nuances of each issue and match it precisely with the described capabilities of the agents.\
If no specialized agent is a perfect fit for an issue or a group of issues, direct it to the generalist agent with comprehensive instructions.
**Make sure all issues from the list are addressed.** You will likely need to delegate to more than one agent to address all issues effectively.

Your response **must** consist of one or more distinct blocks, each delegating tasks to a specific agent. Each block **must** follow this exact format:
* Name
<agent_name_here_on_newline>
* Instructions
<detailed_instructions_here_on_newline>

**Example of expected output structure (if multiple agents are chosen to address different issues):**
* Name
<Agent_A_Name>
* Instructions
Instructions for Agent A to solve Issue 1, Issue 2, etc. (mention specific issues)

* Name
<Agent_B_Name>
* Instructions
Instructions for Agent B to solve Issue 3, Issue 4, etc. (mention specific issues)
`);

    const response = await this.streamOrInvoke(
      [sys_message, human_message],
      {
        enableTools: false,
        emitResponseChunks: false,
      },
      {
        cacheKey: getCacheKey(state),
      },
    );

    if (!response) {
      return {
        plannerOutputNominatedAgents: [],
        iterationCount: state.iterationCount,
      };
    }

    return {
      plannerOutputNominatedAgents: this.parsePlannerResponse(response),
      iterationCount: state.iterationCount + 1,
    };
  }

  // node responsible for addressing general issues when planner cannot find a more specific node
  async fixGeneralIssues(
    state: typeof GeneralIssueFixInputState.State,
  ): Promise<typeof GeneralIssueFixOutputState.State> {
    const sys_message = new SystemMessage(
      `You are an experienced ${state.programmingLanguage} programmer, specializing in migrating source code from ${state.migrationHint}.\
We updated a source code file to migrate the source code. There may be more changes needed elsewhere in the project.\
You are given notes detailing additional changes that need to happen.\
Carefully analyze the changes and understand what files in the project need to be changed.\
The notes may contain details about changes already made. Please do not act on any of the changes already made. Assume they are correct and only focus on any additional changes needed.\
You have access to a set of tools to search for files, read a file and write to a file.\
Work on one file at a time. **Completely address changes in one file before moving onto to next file.**\
Explain you rationale while you make changes to files.\
When you're done addressing all the changes or there are no additional changes, briefly summarize changes you made.\
`,
    );

    const chat: BaseMessage[] = state.messages ?? [];

    if (chat.length === 0) {
      chat.push(sys_message);
      chat.push(
        new HumanMessage(`
Here are the notes:\
${state.inputInstructionsForGeneralFix}
${
  state.inputUrisForGeneralFix && state.inputUrisForGeneralFix.length > 0
    ? `The above issues were found in following files:\n${state.inputUrisForGeneralFix.join("\n")}`
    : ``
}`),
      );
    }

    const response = await this.streamOrInvoke(
      chat,
      {
        toolsSelectors: [".*File.*"],
      },
      {
        cacheKey: getCacheKey(state),
      },
    );

    if (!response) {
      return {
        messages: [new AIMessage(`DONE`)],
        outputModifiedFilesFromGeneralFix: [],
        iterationCount: state.iterationCount,
      };
    }

    return {
      messages: [response],
      outputModifiedFilesFromGeneralFix: [],
      iterationCount: state.iterationCount + 1,
    };
  }

  // this is intentionally not generalized for all dependencies, only for pom.xml files
  // TODO (pgaikwad) - generalize this when we move to other languages
  // TODO (pgaikwad) - add gradle support
  async fixJavaDependencyIssues(
    state: typeof GeneralIssueFixInputState.State,
  ): Promise<typeof GeneralIssueFixOutputState.State> {
    const sys_message = new SystemMessage(
      `You are an expert Java developer specializing in dependency management and migrating source code from / to ${state.migrationHint}.`,
    );

    const human_message = new HumanMessage(`
Your task is to resolve compilation or runtime errors in a Java project by identifying and adding missing dependencies to the project's pom.xml file.

**Your Goal:**
Successfully add necessary dependencies or modify existing dependencies to resolve identified issues, ensuring the project compiles and runs correctly.

**Information Provided:**
You will be given information about the issues found, which may include compilation errors, stack traces from runtime errors, or descriptions of missing classes/methods.\
Determine whether the given issue can be fixed by adding, modifying, updating or deleting one or more dependency.\
You have access to a set of tools to search for files, read a file and write to a file.\
You also have access to specific tools that will help you determine which dependency to add.\
Explain you rationale while you make changes to files.\
If the given issue cannot be solved by adding, modifying, updating or deleting dependencies, do not take any action.\
Explain your rationale as you make changes.\

${
  state.inputUrisForGeneralFix && state.inputUrisForGeneralFix.length > 0
    ? `* Files in which these issues were found:\n${state.inputUrisForGeneralFix.join("\n")}`
    : ``
}

Here are the issues:\
${state.inputInstructionsForGeneralFix}
`);

    const chat: BaseMessage[] = state.messages ?? [];

    if (chat.length === 0) {
      chat.push(sys_message);
      chat.push(human_message);
    }

    const response = await this.streamOrInvoke(
      chat,
      {},
      {
        cacheKey: getCacheKey(state),
      },
    );

    if (!response) {
      return {
        messages: [new AIMessage(`DONE`)],
        outputModifiedFilesFromGeneralFix: [],
        iterationCount: state.iterationCount,
      };
    }

    return {
      messages: [response],
      outputModifiedFilesFromGeneralFix: [],
      iterationCount: state.iterationCount + 1,
    };
  }

  private parsePlannerResponse(
    response: AIMessageChunk | AIMessage,
  ): Array<{ [key in PlannerResponseParserState]: string }> {
    const allAgents: Array<{ [key in PlannerResponseParserState]: string }> = [];
    const content: string = typeof response.content === "string" ? response.content : "";

    if (content) {
      let parserState: PlannerResponseParserState | undefined = undefined;

      const matcherFunc = (line: string): PlannerResponseParserState | undefined => {
        return line.match(/^(\*|#)* *(?:N|n)ame/)
          ? "name"
          : line.match(/^(\*|#)* *(?:I|i)nstructions/)
            ? "instructions"
            : undefined;
      };

      let buffer: string[] = [];
      for (const rawLine of content.split("\n")) {
        const line = rawLine.trim();
        const nextState = matcherFunc(line);
        if (nextState) {
          if (parserState && buffer.length > 0) {
            switch (parserState) {
              case "name": {
                allAgents.push({
                  name: buffer.join("\n").trim(),
                  instructions: "",
                });
                break;
              }
              case "instructions": {
                if (allAgents.length > 0) {
                  allAgents[allAgents.length - 1].instructions = buffer.join("\n").trim();
                }
                break;
              }
            }
          }
          buffer = [];
          parserState = nextState;
        } else {
          buffer.push(line);
        }
      }
      if (parserState === "instructions" && buffer.length) {
        if (allAgents.length > 0) {
          allAgents[allAgents.length - 1].instructions = buffer.join("\n").trim();
        }
      }
    }

    return allAgents;
  }
}
