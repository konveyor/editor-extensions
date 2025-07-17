import expect from "expect";
import {
  type BindToolsInput,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { Runnable } from "@langchain/core/runnables";
import { AIMessageChunk, AIMessage } from "@langchain/core/messages";
import { FakeStreamingChatModel } from "@langchain/core/utils/testing";
import { type BaseLLMParams } from "@langchain/core/language_models/llms";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";

import { runModelHealthCheck } from "../modelProvider";

class FakeChatModelWithToolCalls extends FakeStreamingChatModel {
  private ai_responses: AIMessage[];
  constructor(
    fields: {
      sleep?: number;
      responses?: AIMessage[];
      thrownErrorString?: string;
    } & BaseLLMParams,
  ) {
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
}

describe("model health check test", () => {
  it("should have tools enabled for model with tool support", async () => {
    const model = new FakeChatModelWithToolCalls({
      responses: [
        new AIMessage({
          content: ``,
          tool_calls: [
            {
              id: "tool_call_id_000",
              args: {
                a: 2,
                b: 2,
              },
              name: "gamma",
              type: "tool_call",
            },
          ],
        }),
      ],
    });

    const { supportsTools } = await runModelHealthCheck(model, model);
    expect(supportsTools).toBe(true);
  });

  it("should not have tools enabled for model with no tool support", async () => {
    const model = new FakeChatModelWithToolCalls({
      responses: [
        new AIMessage({
          content: ``,
        }),
      ],
    });

    const { supportsTools } = await runModelHealthCheck(model, model);
    expect(supportsTools).toBe(false);
  });
});
