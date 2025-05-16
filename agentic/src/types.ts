//TODO (ibolton) - move to shared
import { type RunnableConfig } from "@langchain/core/runnables";
import { type EnhancedIncident } from "@editor-extensions/shared";
import { type AIMessageChunk, type AIMessage } from "@langchain/core/messages";
import { type BaseChatModel } from "@langchain/core/language_models/chat_models";

export interface BaseWorkflowMessage<KaiWorkflowMessageType, D> {
  type: KaiWorkflowMessageType;
  id: string;
  data: D;
}

export enum KaiWorkflowMessageType {
  LLMResponseChunk,
  LLMResponse,
  ModifiedFile,
  ToolCall,
  UserInteraction,
  Error,
}

export interface KaiModifiedFile {
  path: string;
  content: string;
}

export interface KaiToolCall {
  id: string;
  name?: string;
  args?: string;
  status: "generating" | "running" | "succeeded" | "failed";
}

export interface KaiUserIteraction {
  type: "yesNo" | "choice";
  systemMessage: {
    yesNo?: string;
    choice?: string[];
  };
  response?: {
    yesNo?: boolean;
    choice?: number;
  };
}

export type KaiWorkflowMessage =
  | BaseWorkflowMessage<KaiWorkflowMessageType.LLMResponseChunk, AIMessageChunk>
  | BaseWorkflowMessage<KaiWorkflowMessageType.LLMResponse, AIMessage>
  | BaseWorkflowMessage<KaiWorkflowMessageType.ModifiedFile, KaiModifiedFile>
  | BaseWorkflowMessage<KaiWorkflowMessageType.UserInteraction, KaiUserIteraction>
  | BaseWorkflowMessage<KaiWorkflowMessageType.ToolCall, KaiToolCall>
  | BaseWorkflowMessage<KaiWorkflowMessageType.Error, string>;

export type KaiUserInteractionMessage = BaseWorkflowMessage<
  KaiWorkflowMessageType.UserInteraction,
  KaiUserIteraction
>;

export interface KaiWorkflowEvents {
  on(event: "workflowMessage", listener: (msg: KaiWorkflowMessage) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}

export interface KaiWorkflowInitOptions {
  model: BaseChatModel;
  workspaceDir: string;
}

export interface KaiWorkflowInput {
  //TODO (pgaikwad) - think about this input more
  incidents?: EnhancedIncident[];
  runnableConfig?: RunnableConfig;
}

export interface KaiWorkflowResponse {
  modified_files: KaiModifiedFile[];
  errors: Error[];
}

export interface PendingUserInteraction {
  resolve(response: KaiUserInteractionMessage | PromiseLike<KaiUserInteractionMessage>): void;
  reject(reason: any): void;
}

export interface KaiWorkflow<TWorkflowInput extends KaiWorkflowInput = KaiWorkflowInput>
  extends KaiWorkflowEvents {
  init(options: KaiWorkflowInitOptions): Promise<void>;
  run(input: TWorkflowInput): Promise<KaiWorkflowResponse>;
  resolveUserInteraction(response: KaiUserInteractionMessage): Promise<void>;
}
