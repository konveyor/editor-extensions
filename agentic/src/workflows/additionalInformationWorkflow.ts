import { type MessagesAnnotation } from "@langchain/langgraph";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { CompiledStateGraph, END, START, StateGraph } from "@langchain/langgraph";

import {
  KaiUserInteractionMessage,
  type KaiWorkflow,
  type KaiWorkflowInitOptions,
  type KaiWorkflowInput,
  type KaiWorkflowMessage,
  type KaiWorkflowResponse,
} from "../types";
import {
  AnalysisIssueFixInputState,
  AnalysisIssueFixOutputState,
  AnalysisIssueFixState,
} from "../schemas/analysisIssueFix";
import { modelHealthCheck } from "../utils";
import { FileSystemTools } from "../tools/filesystem";
import { KaiWorkflowEventEmitter } from "../eventEmitter";
import { AnalysisIssueFix } from "../nodes/analysisIssueFix";
import { PendingUserInteraction } from "../types";

export interface AdditionalInfoWorkflowInput extends KaiWorkflowInput {
  previousResponse: string;
  programmingLanguage: string;
  migrationHint: string;
}

export class AdditionalInfoWorkflow
  extends KaiWorkflowEventEmitter
  implements KaiWorkflow<AdditionalInfoWorkflowInput>
{
  // TODO (pgaikwad) - ts expert needed to properly typehint this guy
  private workflow: CompiledStateGraph<any, any, any, any, any, any> | undefined;
  private userInteractionPromises: Map<string, PendingUserInteraction>;

  constructor() {
    super();
    this.workflow = undefined;
    this.userInteractionPromises = new Map<string, PendingUserInteraction>();
  }

  async init(options: KaiWorkflowInitOptions): Promise<void> {
    const fsTools = new FileSystemTools(options.workspaceDir);
    const { supportsTools, connected, supportsToolsInStreaming } = await modelHealthCheck(
      options.model,
    );
    if (!connected) {
      throw Error(`Provided model doesn't seem to have connection`);
    }
    const analysisIssueFixNodes = new AnalysisIssueFix(
      {
        model: options.model,
        toolsSupported: supportsTools,
        toolsSupportedInStreaming: supportsToolsInStreaming,
      },
      fsTools.all(),
    );

    // relay events from nodes back to callers
    analysisIssueFixNodes.on("workflowMessage", (msg: KaiWorkflowMessage) => {
      this.emitWorkflowMessage(msg);
    });
    fsTools.on("workflowMessage", (msg: KaiWorkflowMessage) => {
      this.emitWorkflowMessage(msg);
    });

    const workflow = new StateGraph({
      input: AnalysisIssueFixInputState,
      output: AnalysisIssueFixOutputState,
      stateSchema: AnalysisIssueFixState,
    })
      .addNode("address_additional_information", analysisIssueFixNodes.addressAdditionalInformation)
      .addNode("run_tools", analysisIssueFixNodes.runTools)
      .addEdge(START, "address_additional_information")
      .addEdge("run_tools", "address_additional_information")
      .addConditionalEdges("address_additional_information", this.run_tools_edge, [
        "run_tools",
        END,
      ])
      .compile();
    this.workflow = workflow;
  }

  async run(input: AdditionalInfoWorkflowInput): Promise<KaiWorkflowResponse> {
    if (!this.workflow || !(this.workflow instanceof CompiledStateGraph)) {
      throw new Error(`Workflow must be inited before it can be run`);
    }

    const parsed = this.extractAdditionalInfo(input.previousResponse);

    const gInput: typeof AnalysisIssueFixInputState.State = {
      previousResponse: input.previousResponse,
      additionalInformation: parsed ? parsed : input.previousResponse,
      migrationHint: input.migrationHint,
      programmingLanguage: input.programmingLanguage,
    };

    const outputState: typeof AnalysisIssueFixState.State = await this.workflow.invoke(gInput, {
      recursionLimit: 50,
    });

    return {
      errors: [],
      modified_files: outputState.modifiedFiles,
    };
  }

  async resolveUserInteraction(response: KaiUserInteractionMessage): Promise<void> {}

  private run_tools_edge(state: typeof MessagesAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage instanceof AIMessage || lastMessage instanceof AIMessageChunk) {
      return lastMessage.tool_calls && lastMessage.tool_calls.length > 0 ? "run_tools" : END;
    } else {
      return END;
    }
  }

  private extractAdditionalInfo(content: string): string | null {
    let parsed = "";
    let start = false;
    for (const line of content.split("\n")) {
      if (line.match(/(?:##|\*\*)\s*[Aa]dditional *[Ii]nformation/)) {
        start = true;
        continue;
      }
      if (start) {
        parsed += line;
      }
    }
    return parsed;
  }
}
