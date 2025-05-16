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
  private workflow: CompiledStateGraph<any, any, any, any, any, any> | undefined;
  private userInteractionPromises: Map<string, PendingUserInteraction>;
  private pendingIssues: string[] = [];
  private isProcessingIssues: boolean = false;

  constructor() {
    super();
    this.workflow = undefined;
    this.userInteractionPromises = new Map<string, PendingUserInteraction>();
    this.pendingIssues = [];
    this.isProcessingIssues = false;

    this.runToolsEdge = this.runToolsEdge.bind(this);
    this.processUserInputEdge = this.processUserInputEdge.bind(this);
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
    console.log("resolveUserInteraction called with:", response);
    const promise = this.userInteractionPromises.get(response.id);
    console.log("Found promise:", promise ? "yes" : "no");
    if (!promise) {
      console.log("No promise found for id:", response.id);
      return;
    }
    const { data } = response;
    if (!data.response || (!data.response.choice && data.response.yesNo === undefined)) {
      console.log("Invalid response data:", data);
      promise.reject(Error(`Invalid response from user`));
    }
    console.log("Resolving promise with response");
    promise.resolve(response);
  }

  private async processUserInputEdge(state: typeof AdditionalInfoSummarizeOutputState.State) {
    let nextState = "END";

    if (state.additionalInformation !== "" && !state.additionalInformation.includes("NO-CHANGE")) {
      // Add this issue to our pending issues
      this.pendingIssues.push(state.additionalInformation);

      // If we're not already processing issues, start processing them
      if (!this.isProcessingIssues) {
        this.isProcessingIssues = true;

        try {
          const id = `res-${Date.now()}`;
          console.log("Creating user interaction promise with id:", id);

          const userInteractionPromise = new Promise<KaiUserInteractionMessage>(
            (resolve, reject) => {
              this.userInteractionPromises.set(id, {
                resolve,
                reject,
              });
            },
          );

          // Emit a single message for all pending issues
          console.log("Emitting workflow message with id:", id);
          this.emitWorkflowMessage({
            id,
            type: KaiWorkflowMessageType.UserInteraction,
            data: {
              type: "yesNo",
              systemMessage: {
                yesNo:
                  this.pendingIssues.length > 1
                    ? `We found ${this.pendingIssues.length} issues that we think we can fix. Would you like me to address them?`
                    : "We found an issue that we think we can fix. Would you like me to address it?",
              },
            },
          });

          console.log("Waiting for user response...");
          const userResponse = await userInteractionPromise;
          console.log("Got user response:", userResponse);

          if (userResponse.data.response?.yesNo) {
            nextState = "address_additional_information";
          }

          // Clear pending issues after processing
          this.pendingIssues = [];
        } catch (e) {
          console.log(`Failed to wait for user response - ${e}`);
        } finally {
          this.isProcessingIssues = false;
        }
      } else {
        // If we're already processing issues, just wait for the current batch to complete
        nextState = "address_additional_information";
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
