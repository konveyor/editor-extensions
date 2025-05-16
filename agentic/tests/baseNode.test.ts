import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";

import { KaiWorkflowMessageType } from "../src";
import { FakeChatModelWithToolCalls } from "./base";
import { BaseNode, type ModelInfo } from "../src/nodes/base";

class TestNode extends BaseNode {
  constructor(modelInfo: ModelInfo, tools: DynamicStructuredTool[]) {
    super("test", modelInfo, tools);

    this.invoke = this.invoke.bind(this);
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
  it("should stream chunks correctly with models that don't support tools, response contains single tool call", async () => {
    const testResponse =
      'To calculate the value, I will use the gamma tool.\nTOOL_CALL\n```{"tool_name": "gamma", "args": {"a": 2, "b": 2} }```';
    const model = new FakeChatModelWithToolCalls(
      {
        responses: [
          new AIMessage({
            content: testResponse,
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
    expect(response?.content).toBe(testResponse);
    expect(response?.tool_calls?.length).toBe(1);
    expect(response?.tool_calls![0].name).toBe("gamma");
    expect(response?.tool_calls![0].args).toEqual({ a: 2, b: 2 });
  });

  it("should stream chunks correctly with models that don't support tools, responses contain multiple tool calls", async () => {
    const testResponse = `To address the additional changes, I need to start by locating the
\`pom.xml\` file to add the \`smallrye-reactive-messaging-jms\` extension.
TOOL_CALL
\`\`\`json
{
  "tool_name": "searchFiles",
  "args": {
    "pattern": "pom.xml"
  }
}
\`\`\`\
I will then search for application.properties file.
TOOL_CALL
\`\`\`json
{
  "tool_name": "searchFiles",
  "args": {
    "pattern": "application.properties"
  }
}
\`\`\``;

    const model = new FakeChatModelWithToolCalls(
      {
        responses: [
          new AIMessage({
            content: testResponse,
          }),
        ],
      },
      true,
    );

    const node = new TestNode(
      {
        model,
        toolsSupported: false,
        toolsSupportedInStreaming: false,
      },
      [],
    );

    const { response } = await node.invoke("Fix that issue that I told you about, will ya?");
    expect(response?.content).toBe(testResponse);
    expect(response?.tool_calls?.length).toBe(2);
    expect(response?.tool_calls![0].name).toBe("searchFiles");
    expect(response?.tool_calls![0].args).toEqual({ pattern: "pom.xml" });
    expect(response?.tool_calls![1].name).toBe("searchFiles");
    expect(response?.tool_calls![1].args).toEqual({ pattern: "application.properties" });
  });

  it("should stream chunks correctly with models that don't support tools, responses may not contain tool call markers", async () => {
    const testResponse = `To address the additional changes, I need to start by locating the
\`pom.xml\` file to add the \`smallrye-reactive-messaging-jms\` extension.
\`\`\`json
{
  "tool_name": "searchFiles",
  "args": {
    "pattern": "pom.xml"
  }
}
\`\`\`\
I will then search for application.properties file.
TOOL_CALL
\`\`\`
{
  "tool_name": "searchFiles",
  "args": {
    "pattern": "application.properties"
  }
}
\`\`\``;

    const model = new FakeChatModelWithToolCalls(
      {
        responses: [
          new AIMessage({
            content: testResponse,
          }),
        ],
      },
      true,
    );

    const node = new TestNode(
      {
        model,
        toolsSupported: false,
        toolsSupportedInStreaming: false,
      },
      [],
    );

    const { response } = await node.invoke("Fix that issue that I told you about, will ya?");
    expect(response?.content).toBe(testResponse);
    expect(response?.tool_calls?.length).toBe(2);
    expect(response?.tool_calls![0].name).toBe("searchFiles");
    expect(response?.tool_calls![0].args).toEqual({ pattern: "pom.xml" });
    expect(response?.tool_calls![1].name).toBe("searchFiles");
    expect(response?.tool_calls![1].args).toEqual({ pattern: "application.properties" });
  });

  it("should stream chunks correctly when there are no tool calls in the message", async () => {
    const testResponse = `I will first read contents of the \`pom.xml\` file.\
Then I will add the required dependencies to the file. I will then read contents
of the \`application.properties\` file. Then I will add the JMS topic to it.
`;

    const model = new FakeChatModelWithToolCalls(
      {
        responses: [
          new AIMessage({
            content: testResponse,
          }),
        ],
      },
      true,
    );

    const node = new TestNode(
      {
        model,
        toolsSupported: false,
        toolsSupportedInStreaming: false,
      },
      [],
    );

    const { chunks, response } = await node.invoke(
      "Fix that issue that I told you about, will ya?",
    );
    expect(response?.content).toBe(testResponse);
    expect(response?.tool_calls?.length).toBe(0);
    const appendedChunks: AIMessageChunk = chunks.reduce((acc, val) => {
      acc = acc.concat(val);
      return acc;
    }, new AIMessageChunk(``));
    expect(appendedChunks?.content).toBe(testResponse);
  });
});
