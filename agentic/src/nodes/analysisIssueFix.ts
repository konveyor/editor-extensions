import { type DynamicStructuredTool } from "@langchain/core/tools";
import { AIMessage, type BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";

import { BaseNode, type ModelInfo } from "./base";
import { type AnalysisIssueFixState } from "../schemas/analysisIssueFix";

export class AnalysisIssueFix extends BaseNode {
  constructor(modelInfo: ModelInfo, tools: DynamicStructuredTool[]) {
    super("AnalysisIssueFix", modelInfo, tools);
    this.addressAdditionalInformation = this.addressAdditionalInformation.bind(this);
    this.summarizeAdditionalInformation = this.summarizeAdditionalInformation.bind(this);
  }

  async summarizeAdditionalInformation(state: typeof AnalysisIssueFixState.State) {
    const sys_message = new SystemMessage(
      `You are an experienced ${state.programmingLanguage} programmer, specializing in migrating source code to ${state.migrationHint}.`,
    );
    const human_message = new HumanMessage(
      `We have migrated some source code files to ${state.migrationHint}.\
You are given notes we captured during the migration.\
The notes contain a summary of changes we already made to existing files and additional changes that may be required in other files elsewhere in the project.\
They also contain a list of files we changed.\
Carefully analyze the notes and understand what additional changes are mentioned in the notes.\
Output the additional changes mentioned in the notes. Do not output any of the changes we have already made.\
Make sure you output all the details about the changes including code snippets and instructions.\
Ensure you do not omit any additional changes needed.\
If there are no additional changes mentioned, respond with text "NO-CHANGE".\
Here is the summary: \
${state.previousResponse}`,
    );

    const response = await this.streamOrInvoke([sys_message, human_message], false, false);

    return {
      additionalInformation: response?.content || "",
    };
  }

  async addressAdditionalInformation(state: typeof AnalysisIssueFixState.State) {
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

    const chat: BaseMessage[] = state.messages;

    if (state.messages.length === 0) {
      chat.push(sys_message);
      chat.push(
        new HumanMessage(`
Here are the notes:\
${state.additionalInformation}`),
      );
    }

    const response = await this.streamOrInvoke(chat);

    if (!response) {
      return {
        messages: new AIMessage(`DONE`),
      };
    }

    return {
      messages: response,
    };
  }
}
