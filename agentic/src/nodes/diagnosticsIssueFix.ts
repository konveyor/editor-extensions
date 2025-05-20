import { type DynamicStructuredTool } from "@langchain/core/tools";
import { SystemMessage, HumanMessage, AIMessageChunk, AIMessage } from "@langchain/core/messages";

import {
  DiagnosticsPlannerInputState,
  type DiagnosticsPlannerOutputState,
} from "../schemas/diagnosticsIssueFix";
import { KaiFsCache } from "../types";
import { BaseNode, type ModelInfo } from "./base";

export class DiagnosticsIssueFix extends BaseNode {
  constructor(
    modelInfo: ModelInfo,
    private readonly fsTools: DynamicStructuredTool[],
    private readonly dependencyTools: DynamicStructuredTool[],
    private readonly fsCache: KaiFsCache,
  ) {
    super("DiagnosticsIssueFix", modelInfo, [...fsTools, ...dependencyTools]);
    this.fsCache = fsCache;

    this.planFixes = this.planFixes.bind(this);
  }

  // node responsible for determining which nodes to delegate work to
  // knows about changes made so far, outputs instructions for the node
  async planFixes(
    state: typeof DiagnosticsPlannerInputState.State,
  ): Promise<typeof DiagnosticsPlannerOutputState.State> {
    if (!state.tasks || state.tasks.length === 0) {
      return {
        agents: [],
      };
    }

    const sys_message = new SystemMessage(
      `You are an experienced architect overlooking migration of a ${state.programmingLanguage} application from ${state.migrationHint}.\
You are given `,
    );

    let agentDescriptions = "";
    state.agents.forEach((a) => {
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
${state.tasks}

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
        agents: [],
      };
    }

    return {
      agents: this.parsePlannerResponse(response),
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
        return line.match(/^(?:N|n)ame: *(.*)/)
          ? "name"
          : line.match(/^(?:I|i)nstructions *: *(.*)$/)
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
