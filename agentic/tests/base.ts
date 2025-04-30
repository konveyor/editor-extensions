import { IterableReadableStream } from "@langchain/core/utils/stream";
import { FakeStreamingChatModel } from "@langchain/core/utils/testing";
import { type BaseLLMParams } from "@langchain/core/language_models/llms";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessageChunk, type AIMessage, type BaseMessage } from "@langchain/core/messages";
import { type BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";

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
