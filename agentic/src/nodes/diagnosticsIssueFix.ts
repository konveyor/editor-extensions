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
  type KaiModifiedFile,
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

export class DiagnosticsIssueFix extends BaseNode {
  private readonly diagnosticsPromises: Map<string, PendingUserInteraction>;

  static readonly SubAgents: { [key in AgentName]?: string } = {
    generalFix: "Fixes general issues, use when no other specialized agent is available",
  } as const;

  constructor(
    modelInfo: ModelInfo,
    private readonly fsTools: DynamicStructuredTool[],
    private readonly dependencyTools: DynamicStructuredTool[],
    private readonly fsCache: KaiFsCache,
  ) {
    super("DiagnosticsIssueFix", modelInfo, [...fsTools, ...dependencyTools]);
    this.fsCache = fsCache;
    this.diagnosticsPromises = new Map<string, PendingUserInteraction>();

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
      !state.inputDiagnosticsTasks &&
      !state.inputSummarizedAdditionalInfo &&
      (!state.outputNominatedAgents || state.outputNominatedAgents.length < 1)
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
    if (state.outputNominatedAgents && state.outputNominatedAgents.length > 0) {
      const nextSelection = state.outputNominatedAgents.pop();
      if (nextSelection) {
        const { name, instructions } = nextSelection;
        switch (name as AgentName) {
          case "generalFix":
            nextState.inputInstructionsForGeneralFix = instructions;
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
      nextState.plannerInputTasks = [state.inputSummarizedAdditionalInfo];
      nextState.inputSummarizedAdditionalInfo = undefined;
    } else if (state.inputDiagnosticsTasks) {
      // pick the next task from the list
      nextState.currentTask = state.inputDiagnosticsTasks.pop();
      nextState.plannerInputTasks = nextState.currentTask?.tasks;
      nextState.inputDiagnosticsTasks = state.inputDiagnosticsTasks;
    }
    return nextState;
  }

  // node responsible for determining which nodes to delegate work to
  // knows about changes made so far, outputs instructions for the node
  async planFixes(
    state: typeof DiagnosticsPlannerInputState.State,
  ): Promise<typeof DiagnosticsPlannerOutputState.State> {
    if (!state.plannerInputTasks || state.plannerInputTasks.length === 0) {
      return {
        outputNominatedAgents: [],
      };
    }

    const sys_message = new SystemMessage(
      `You are an experienced architect overlooking migration of a ${state.programmingLanguage} application from ${state.migrationHint}.\
You are given `,
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

**Here is the list of issues that need to be solved:**
${state.plannerInputTasks.join("\n")}

Your task is to carefully analyze each issue in the list and determine the most suitable agent to address it.\
You will output the **name of the selected agent** on a new line followed by **specific, clear instructions** tailored to that agent's expertise on the next line, each with a section header explained in the format below.\
The instructions should detail how each agent should approach and solve the problem. **Make sure** your instructions take into account the overall migration effort.\
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
${state.inputInstructionsForGeneralFix}`),
      );
    }

    const modifiedFiles: KaiModifiedFile[] = [];

    this.on("workflowMessage", (msg) => {
      if (msg.type === KaiWorkflowMessageType.ModifiedFile) {
        modifiedFiles.push(msg.data);
      }
    });

    const response = await this.streamOrInvoke(chat);

    if (!response) {
      return {
        messages: [new AIMessage(`DONE`)],
        outputModifiedFilesFromGeneralFix: modifiedFiles,
      };
    }

    return {
      messages: [response],
      outputModifiedFilesFromGeneralFix: modifiedFiles,
    };
  }

  private parsePlannerResponse(response: AIMessageChunk | AIMessage): {
    name: string;
    instructions: string;
  }[] {
    const allAgents: { name: string; instructions: string }[] = [];
    const content: string = typeof response.content === "string" ? response.content : "";

    if (content) {
      let parserState: "name" | "inst" | undefined = undefined;

      const matcherFunc = (line: string): "name" | "inst" | undefined => {
        return line.match(/^(\*|#)* *(?:N|n)ame/)
          ? "name"
          : line.match(/^(\*|#)* *(?:I|i)nstructions/)
            ? "inst"
            : undefined;
      };

      for (const line of content.split("\n")) {
        const nextState = matcherFunc(line);
        parserState = nextState ?? parserState;

        if (nextState === undefined) {
          switch (parserState) {
            case "name": {
              allAgents.push({
                name: line,
                instructions: "",
              });
              break;
            }
            case "inst": {
              if (allAgents.length > 0) {
                allAgents[allAgents.length - 1].instructions += line;
              }
              break;
            }
          }
        }
      }
    }

    return allAgents;
  }
}
