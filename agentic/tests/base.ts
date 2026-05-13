import { IterableReadableStream } from "@langchain/core/utils/stream";
import { FakeStreamingChatModel } from "@langchain/core/utils/testing";
import { type BaseLLMParams } from "@langchain/core/language_models/llms";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessageChunk, type AIMessage, type BaseMessage } from "@langchain/core/messages";
import {
  type BindToolsInput,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";

import { KaiModelProvider, KaiModelProviderInvokeCallOptions } from "../src/types";

export class FakeChatModelWithToolCalls extends FakeStreamingChatModel {
  private ai_responses: AIMessage[];
  constructor(
    fields: {
      sleep?: number;
      responses?: AIMessage[];
      thrownErrorString?: string;
    } & BaseLLMParams,
    enableChunking?: boolean,
  ) {
    if (enableChunking) {
      fields.responses = fields.responses?.flatMap((response) =>
        getAIMessageIntoRandomChunks(response),
      );
    }
    super(fields);
    this.ai_responses = fields.responses!;
  }

  bindTools(
    _tools: BindToolsInput[],
    _kwargs?: Partial<BaseChatModelCallOptions> | undefined,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> {
    return this;
  }

  async invoke(
    input: BaseLanguageModelInput,
    options?: BaseChatModelCallOptions | undefined,
  ): Promise<AIMessageChunk> {
    const response = await super.invoke(input, options);

    const matchingRes = this.ai_responses.find((item) => item.content === response.content);
    if (matchingRes) {
      response.tool_calls = matchingRes.tool_calls;
    }
    return response;
  }

  async stream(
    /* trunk-ignore(eslint/@typescript-eslint/no-unused-vars) */
    input: BaseLanguageModelInput,
    /* trunk-ignore(eslint/@typescript-eslint/no-unused-vars) */
    options?: Partial<BaseChatModelCallOptions> | undefined,
  ): Promise<IterableReadableStream<AIMessageChunk>> {
    return IterableReadableStream.fromAsyncGenerator(yieldResponses(this.responses!));
  }
}

async function* yieldResponses(responses: BaseMessage[]): AsyncGenerator<AIMessageChunk> {
  for (const res of responses) {
    yield res as AIMessageChunk;
  }
}

// helper function to split an AIMessage into chunks randomly, only works on content not tool_calls
export function getAIMessageIntoRandomChunks(message: AIMessage): AIMessageChunk[] {
  const responses: AIMessageChunk[] = [];
  if (!message.content) {
    return responses;
  }
  let remaining = message.content as string;
  while (remaining.length > 0) {
    const chunkSize = Math.floor(Math.random() * remaining.length) + 1;
    const chunk = remaining.slice(0, chunkSize);
    responses.push(new AIMessageChunk(chunk));
    remaining = remaining.slice(chunkSize);
  }
  return responses;
}

export class FakeModelProvider implements KaiModelProvider {
  constructor(
    private readonly model: FakeChatModelWithToolCalls,
    private readonly tools: BindToolsInput[],
    private readonly supportsToolCalls: boolean,
    private readonly supportsToolCallsInStreaming: boolean,
  ) {}

  bindTools(
    tools: BindToolsInput[],
    _kwargs?: Partial<KaiModelProviderInvokeCallOptions> | undefined,
  ): KaiModelProvider {
    return new FakeModelProvider(
      this.model,
      tools,
      this.supportsToolCalls,
      this.supportsToolCallsInStreaming,
    );
  }

  invoke(
    input: BaseLanguageModelInput,
    options?: KaiModelProviderInvokeCallOptions | undefined,
  ): Promise<AIMessageChunk> {
    if (this.tools.length) {
      return this.model.bindTools(this.tools, options).invoke(input, options);
    }
    return this.model.invoke(input, options);
  }

  stream(
    input: any,
    options?: Partial<RunnableConfig<Record<string, any>>> | undefined,
  ): Promise<IterableReadableStream<any>> {
    return this.model.stream(input, options);
  }

  toolCallsSupported(): boolean {
    return this.supportsToolCalls;
  }

  toolCallsSupportedInStreaming(): boolean {
    return this.supportsToolCallsInStreaming;
  }
}
