import { type MessagesAnnotation } from "@langchain/langgraph";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { CompiledStateGraph, END, START, StateGraph } from "@langchain/langgraph";

import {
  KaiUserInteractionMessage,
  KaiWorkflowMessageType,
  type PendingUserInteraction,
  type KaiWorkflow,
  type KaiWorkflowInitOptions,
  type KaiWorkflowInput,
  type KaiWorkflowMessage,
  type KaiWorkflowResponse,
} from "../types";
import {
  AdditionalInfoSummarizeInputState,
  AdditionalInfoSummarizeOutputState,
  AddressAdditionalInfoOutputState,
  AnalysisIssueFixOverallState,
} from "../schemas/analysisIssueFix";
import { modelHealthCheck } from "../utils";
import { FileSystemTools } from "../tools/filesystem";
import { KaiWorkflowEventEmitter } from "../eventEmitter";
import { AnalysisIssueFix } from "../nodes/analysisIssueFix";

export interface AdditionalInfoWorkflowInput extends KaiWorkflowInput {
  previousResponses: {
    files: string[];
    responses: string[];
  };
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

    this.runToolsEdge = this.runToolsEdge.bind(this);
    this.processUserInputEdge = this.processUserInputEdge.bind(this);
  }

  async init(options: KaiWorkflowInitOptions): Promise<void> {
    const fsTools = new FileSystemTools(options.workspaceDir, options.fsCache);
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
      options.fsCache,
    );

    // relay events from nodes back to callers
    analysisIssueFixNodes.on("workflowMessage", (msg: KaiWorkflowMessage) => {
      this.emitWorkflowMessage(msg);
    });
    fsTools.on("workflowMessage", (msg: KaiWorkflowMessage) => {
      this.emitWorkflowMessage(msg);
    });

    const workflow = new StateGraph({
      input: AdditionalInfoSummarizeInputState,
      output: AddressAdditionalInfoOutputState,
      stateSchema: AnalysisIssueFixOverallState,
    })
      .addNode("summarize", analysisIssueFixNodes.summarizeAdditionalInformation)
      .addNode("address_additional_information", analysisIssueFixNodes.addressAdditionalInformation)
      .addNode("run_tools", analysisIssueFixNodes.runTools)
      .addEdge(START, "summarize")
      .addEdge("run_tools", "address_additional_information")
      .addConditionalEdges("address_additional_information", this.runToolsEdge, ["run_tools", END])
      .addConditionalEdges("summarize", this.processUserInputEdge, [
        "address_additional_information",
        END,
      ])
      .compile();
    this.workflow = workflow;
  }

  async run(input: AdditionalInfoWorkflowInput): Promise<KaiWorkflowResponse> {
    if (!this.workflow || !(this.workflow instanceof CompiledStateGraph)) {
      throw new Error(`Workflow must be inited before it can be run`);
    }

    const gInput: typeof AdditionalInfoSummarizeInputState.State = {
      previousResponse: this.processInput(input.previousResponses),
      migrationHint: input.migrationHint,
      programmingLanguage: input.programmingLanguage,
    };

    const outputState: typeof AnalysisIssueFixOverallState.State = await this.workflow.invoke(
      gInput,
      {
        recursionLimit: 50,
      },
    );

    return {
      errors: [],
      modified_files: outputState?.modifiedFiles || [],
    };
  }

  async resolveUserInteraction(response: KaiUserInteractionMessage): Promise<void> {
    const promise = this.userInteractionPromises.get(response.id);
    if (!promise) {
      return;
    }
    const { data } = response;
    if (!data.response || (!data.response.choice && data.response.yesNo === undefined)) {
      promise.reject(Error(`Invalid response from user`));
    }
    promise.resolve(response);
  }

  private async processUserInputEdge(state: typeof AdditionalInfoSummarizeOutputState.State) {
    let nextState = "END";
    if (state.additionalInformation !== "" && !state.additionalInformation.includes("NO-CHANGE")) {
      const id = `res-${Date.now()}`;
      const userInteractionPromise = new Promise<KaiUserInteractionMessage>((resolve, reject) => {
        this.userInteractionPromises.set(id, {
          resolve,
          reject,
        });
      });
      this.emitWorkflowMessage({
        id,
        type: KaiWorkflowMessageType.UserInteraction,
        data: {
          type: "yesNo",
          systemMessage: {
            yesNo:
              "We found more issues that we think we can fix. Do you want me to continue fixing those?",
          },
        },
      });
      try {
        const userResponse = await userInteractionPromise;
        if (userResponse.data.response?.yesNo) {
          nextState = "address_additional_information";
        }
      } catch (e) {
        console.log(`Failed to wait for user response - ${e}`);
      } finally {
        this.userInteractionPromises.delete(id);
      }
    }
    return nextState;
  }

  private runToolsEdge(state: typeof MessagesAnnotation.State) {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage instanceof AIMessage || lastMessage instanceof AIMessageChunk) {
      return lastMessage.tool_calls && lastMessage.tool_calls.length > 0 ? "run_tools" : END;
    } else {
      return END;
    }
  }

  private processInput(responses: { files: string[]; responses: string[] }): string {
    let reasoning = "";
    let additionalInfo = "";
    for (const res of responses.responses) {
      let parserState = "initial";
      for (const resLine of res.split("\n")) {
        const nextState = (line: string) =>
          line.match(/(##|\*\*) *[R|r]easoning/)
            ? "reasoning"
            : line.match(/(##|\*\*) *[U|u]pdated [F|f]ile/)
              ? "updatedFile"
              : line.match(/(##|\*\*) *[A|a]dditional *[I|i]nformation/)
                ? "additionalInfo"
                : undefined;

        const nxtState = nextState(resLine);
        parserState = nxtState || parserState;
        if (nxtState === undefined) {
          switch (parserState) {
            case "reasoning":
              reasoning += `\n${resLine}`;
              break;
            case "additionalInfo":
              additionalInfo += `\n${resLine}`;
              break;
          }
        }
      }
    }
    return `## Summary of changes made\n\n${reasoning}\n\n\
## Additional Information\n\n${additionalInfo}\n\n\
## List of files changed\n\n${responses.files.join("\n")}`;
  }
}
