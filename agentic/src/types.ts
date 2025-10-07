import { type AIMessageChunk, type AIMessage, type BaseMessage } from "@langchain/core/messages";
import {
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import { type EnhancedIncident } from "@editor-extensions/shared";
import { type RunnableConfig } from "@langchain/core/runnables";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";

import { type FileBasedResponseCache, type InMemoryCacheWithRevisions } from "./cache";
import { SolutionServerClient } from "./clients/solutionServerClient";

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
  userInteraction?: KaiUserInteraction;
}

export interface KaiToolCall {
  id: string;
  name?: string;
  args?: string;
  status: "generating" | "running" | "succeeded" | "failed";
}

export interface KaiUserInteraction {
  type: "yesNo" | "choice" | "tasks" | "modifiedFile";
  systemMessage: {
    yesNo?: string;
    choice?: string[];
  };
  response?: {
    yesNo?: boolean;
    choice?: number;
    tasks?: {
      uri: string;
      task: string;
    }[];
  };
}

export type KaiWorkflowMessage =
  | BaseWorkflowMessage<KaiWorkflowMessageType.LLMResponseChunk, AIMessageChunk>
  | BaseWorkflowMessage<KaiWorkflowMessageType.LLMResponse, AIMessage>
  | BaseWorkflowMessage<KaiWorkflowMessageType.ModifiedFile, KaiModifiedFile>
  | BaseWorkflowMessage<KaiWorkflowMessageType.UserInteraction, KaiUserInteraction>
  | BaseWorkflowMessage<KaiWorkflowMessageType.ToolCall, KaiToolCall>
  | BaseWorkflowMessage<KaiWorkflowMessageType.Error, string>;

export type KaiUserInteractionMessage = BaseWorkflowMessage<
  KaiWorkflowMessageType.UserInteraction,
  KaiUserInteraction
>;

export interface KaiWorkflowEvents {
  on(event: "workflowMessage", listener: (msg: KaiWorkflowMessage) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
  removeAllListeners(): void;
}

export interface KaiWorkflowInitOptions {
  modelProvider: KaiModelProvider;
  workspaceDir: string;
  fsCache: InMemoryCacheWithRevisions<string, string>;
  solutionServerClient: SolutionServerClient;
  toolCache: FileBasedResponseCache<
    Record<string, any>, // tool parameters with zod schema
    string
  >;
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

export interface KaiModelProviderInvokeCallOptions extends BaseChatModelCallOptions {
  cacheKey: string;
}

/**
 * An interface for a model provider expected by the agentic module which:
 * - makes model capabilities around tools explicit
 * - adds the ability to take custom call options e.g. cache key
 * All langchain providers should be compatible with this interface with minor changes.
 */
export interface KaiModelProvider<
  InvokeCallOptions extends KaiModelProviderInvokeCallOptions = KaiModelProviderInvokeCallOptions,
  OutputMessageType extends BaseMessage = AIMessage,
  RunInput = any,
  RunOutput = any,
  StreamCallOptions extends RunnableConfig = RunnableConfig,
> {
  stream(
    input: RunInput,
    options?: Partial<StreamCallOptions>,
  ): Promise<IterableReadableStream<RunOutput>>;
  invoke(input: BaseLanguageModelInput, options?: InvokeCallOptions): Promise<OutputMessageType>;
  bindTools(tools: BindToolsInput[], kwargs?: Partial<InvokeCallOptions>): KaiModelProvider;
  toolCallsSupported(): boolean;
  toolCallsSupportedInStreaming(): boolean;
}
