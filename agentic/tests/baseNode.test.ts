import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessage, type AIMessageChunk } from "@langchain/core/messages";

import { KaiWorkflowMessageType } from "../src";
import { FakeChatModelWithToolCalls } from "./base";
import { BaseNode, type ModelInfo } from "../src/nodes/base";

class TestNode extends BaseNode {
  constructor(modelInfo: ModelInfo, tools: DynamicStructuredTool[]) {
    super("test", modelInfo, tools);
  }

  async invoke(input: BaseLanguageModelInput): Promise<{
    chunks: AIMessageChunk[];
    response: AIMessage | AIMessageChunk | undefined;
  }> {
    const chunks: AIMessageChunk[] = [];
    this.on("workflowMessage", (chunk) => {
      if (chunk.type === KaiWorkflowMessageType.LLMResponseChunk) {
        chunks.push(chunk.data);
      }
    });

    const response = await this.streamOrInvoke(input);

    return {
      chunks,
      response,
    };
  }
}

describe("testBaseNode", () => {
  it("should stream chunks correctly with models that don't support tools", async () => {
    const model = new FakeChatModelWithToolCalls(
      {
        responses: [
          new AIMessage({
            content:
              'To calculate the value, I will use the gamma tool.\ntoolCall\n```{"tool_name": "gamma", "args": {"a": 2, "b": 2} }```',
          }),
        ],
      },
      true,
    );

    const adderTool = new DynamicStructuredTool({
      name: "gamma",
      description: "Gamma is a custom math operator that works on two integers",
      schema: z.object({
        a: z.number().describe("First integer"),
        b: z.number().describe("Second integer"),
      }),
      func: async ({ a, b }: { a: number; b: number }) => {
        return a + b;
      },
    });

    const node = new TestNode(
      {
        model,
        toolsSupported: false,
        toolsSupportedInStreaming: false,
      },
      [adderTool],
    );

    const { response } = await node.invoke("What is 2 gamma 2?");
    expect(response?.content).toBe(
      'To calculate the value, I will use the gamma tool.\ntoolCall\n```{"tool_name": "gamma", "args": {"a": 2, "b": 2} }```',
    );
    expect(response?.tool_calls?.length).toBe(1);
    expect(response?.tool_calls![0].name).toBe("gamma");
    expect(response?.tool_calls![0].args).toEqual({ a: 2, b: 2 });
  }, 1000000);
});
