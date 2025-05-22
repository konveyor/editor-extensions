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

import {
  type KaiFsCache,
  type KaiUserInteractionMessage,
  KaiWorkflowMessageType,
  type PendingUserInteraction,
} from "../types";
import {
  type DiagnosticsPlannerInputState,
  type DiagnosticsPlannerOutputState,
  type DiagnosticsOrchestratorState,
  type GeneralIssueFixInputState,
  type GeneralIssueFixOutputState,
} from "../schemas/diagnosticsIssueFix";
import { BaseNode, type ModelInfo } from "./base";

export type AgentName = "generalFix" | "dependency" | "properties";

type PlannerResponseParserState = "name" | "instructions";

export class DiagnosticsIssueFix extends BaseNode {
  private readonly diagnosticsPromises: Map<string, PendingUserInteraction>;

  static readonly SubAgents: { [key in AgentName]?: string } = {
    generalFix: "Fixes general issues, use when no other specialized agent is available",
  } as const;

  constructor(
    modelInfo: ModelInfo,
    private readonly workspaceDir: string,
    private readonly fsTools: DynamicStructuredTool[],
    private readonly dependencyTools: DynamicStructuredTool[],
    private readonly fsCache: KaiFsCache,
  ) {
    super("DiagnosticsIssueFix", modelInfo, [...fsTools, ...dependencyTools]);
    this.fsCache = fsCache;
    this.diagnosticsPromises = new Map<string, PendingUserInteraction>();
    this.workspaceDir = workspaceDir;

    this.planFixes = this.planFixes.bind(this);
    this.fixGeneralIssues = this.fixGeneralIssues.bind(this);
    this.parsePlannerResponse = this.parsePlannerResponse.bind(this);
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
    // when there is nothing to work on, wait for diagnostics information
    if (
      (!state.inputDiagnosticsTasks || !state.inputDiagnosticsTasks.length) &&
      !state.inputSummarizedAdditionalInfo &&
      (!state.outputNominatedAgents || !state.outputNominatedAgents.length)
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
            response.data.response.tasks?.reduce(
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
            ) ?? [];
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
    // if there is already an agent we sent work to, process their outputs and reset state
    if (state.currentAgent) {
      switch (state.currentAgent as AgentName) {
        case "generalFix":
          nextState.inputInstructionsForGeneralFix = undefined;
          nextState.messages = state.messages.map((m) => new RemoveMessage({ id: m.id! }));
          break;
      }
      nextState.currentAgent = undefined;
      nextState.currentTask = undefined;
    }
    // if there are any tasks left that planner already gave us, finish that work first
    if (state.outputNominatedAgents && state.outputNominatedAgents.length) {
      const nextSelection = state.outputNominatedAgents.pop();
      if (nextSelection) {
        const { name, instructions } = nextSelection;
        switch (name as AgentName) {
          case "generalFix":
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
      nextState.outputNominatedAgents = state.outputNominatedAgents || undefined;
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
        outputNominatedAgents: [],
      };
    }

    const sys_message = new SystemMessage(
      `You are an experienced architect overlooking migration of a ${state.programmingLanguage} application from ${state.migrationHint}.`,
    );

    let agentDescriptions = "";
    state.plannerInputAgents.forEach((a) => {
      agentDescriptions += `\n-\tName: ${a.name}\tDescription: ${a.description}`;
    });

    const human_message =
      new HumanMessage(`You are a highly experienced Software Architect, known for your keen analytical skills and deep understanding of various technical domains.\
Your expertise lies in efficiently delegating tasks to the most appropriate specialist to ensure optimal problem resolution.\
You have a roster of specialized agents at your disposal, each with unique capabilities and areas of focus.\
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

Your task is to carefully analyze each issue in the list and determine the most suitable agent to address it.\
You will output the **name of the selected agent** on a new line followed by **specific, clear instructions** tailored to that agent's expertise on the next line, each with a section header explained in the format below.\
The instructions should detail how each agent should approach and solve the problem.\
**Make sure** your instructions take into account previous changes we made for migrating the project. They should align with the overall migration effort.\
Consider the nuances of each issue and match it precisely with the described capabilities of the agents.\
If no specialized agent is a perfect fit, direct the issue to the generalist agent with comprehensive instructions.\
Your response **must** be in following format:

* Name
<agent_name_here_on_newline>
* Instructions
<detailed_instructions_here_on_newline>`);

    const response = await this.streamOrInvoke([sys_message, human_message], {
      enableTools: false,
      emitResponseChunks: false,
    });

    if (!response) {
      return {
        outputNominatedAgents: [],
      };
    }

    return {
      outputNominatedAgents: this.parsePlannerResponse(response),
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
Work on one file at a time. Completely address changes in one file before moving onto to next file.\
Respond with DONE when you're done addressing all the changes or there are no additional changes.\
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

    const response = await this.streamOrInvoke(chat);

    if (!response) {
      return {
        messages: [new AIMessage(`DONE`)],
        outputModifiedFilesFromGeneralFix: [],
      };
    }

    return {
      messages: [response],
      outputModifiedFilesFromGeneralFix: [],
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
