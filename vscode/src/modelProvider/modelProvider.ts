import { z } from "zod";

import {
  BindToolsInput,
  type BaseChatModel,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { type Runnable, type RunnableConfig } from "@langchain/core/runnables";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { SystemMessage, HumanMessage, type AIMessageChunk } from "@langchain/core/messages";
import { type ChatModelCapabilities } from "@editor-extensions/shared";
import { KaiModelProvider, KaiModelProviderInvokeCallOptions } from "@editor-extensions/agentic";

// If there are special cases for a model provider, we will add them here
export const ModelProviders: Record<string, () => KaiModelProvider> = {};

/**
 * Base model provider class used for providers that do not require any special handling of invoke or stream
 * Adds helpful functionality on top of base invoke, stream, and bindTools:
 * - Returns a real error if the model does not support tools instead of silently failing (which most providers do underneath)
 * - Returns a real error if the model does not support streaming or tool calls in streaming
 * - Wraps bindTools to return a ModelProvider instance instead of a base runnable
 *
 * @param streamingModel - The streaming model to use
 * @param nonStreamingModel - The non-streaming model to use
 * @param capabilities - The capabilities of the model
 * @param demoMode - Whether the model is in demo mode
 * @param tools - The tools to use
 * @param toolKwargs - The tool kwargs to use
 */
export class BaseModelProvider implements KaiModelProvider {
  constructor(
    private readonly streamingModel: BaseChatModel,
    private readonly nonStreamingModel: BaseChatModel,
    private readonly capabilities: ChatModelCapabilities,
    private readonly demoMode: boolean = false,
    private readonly tools: BindToolsInput[] | undefined = undefined,
    private readonly toolKwargs: Partial<KaiModelProviderInvokeCallOptions> | undefined = undefined,
  ) {}

  bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<KaiModelProviderInvokeCallOptions>,
  ): KaiModelProvider {
    return new BaseModelProvider(
      this.streamingModel,
      this.nonStreamingModel,
      this.capabilities,
      this.demoMode,
      tools,
      kwargs,
    );
  }

  async invoke(
    input: BaseLanguageModelInput,
    options?: KaiModelProviderInvokeCallOptions,
  ): Promise<AIMessageChunk> {
    if (this.tools && this.nonStreamingModel.bindTools && this.capabilities.supportsTools) {
      return this.nonStreamingModel.bindTools(this.tools, this.toolKwargs).invoke(input, options);
    }
    return this.nonStreamingModel.invoke(input, options);
  }

  stream(
    input: any,
    options?: Partial<RunnableConfig> | undefined,
  ): Promise<IterableReadableStream<any>> {
    if (this.tools && this.streamingModel.bindTools && this.capabilities.supportsToolsInStreaming) {
      return this.streamingModel.bindTools(this.tools, this.toolKwargs).stream(input, options);
    }
    return this.streamingModel.stream(input, options);
  }

  toolCallsSupported(): boolean {
    return this.capabilities.supportsTools;
  }

  toolCallsSupportedInStreaming(): boolean {
    return this.capabilities.supportsToolsInStreaming;
  }
}

/**
 * Check if the model is connected and supports tools
 * @param streamingModel a streaming model
 * @param nonStreamingModel a non-streaming model
 * @returns ChatModelCapabilities
 * @throws Error if the model is not connected
 */
export async function runModelHealthCheck(
  streamingModel: BaseChatModel,
  nonStreamingModel: BaseChatModel,
): Promise<ChatModelCapabilities> {
  const response: ChatModelCapabilities = {
    supportsTools: false,
    supportsToolsInStreaming: false,
  };

  const tool: DynamicStructuredTool = new DynamicStructuredTool({
    name: "gamma",
    description: "Custom operator that works with two numbers",
    schema: z.object({
      a: z.string(),
      b: z.string(),
    }),
    func: async ({ a, b }: { a: string; b: string }) => {
      return a + b;
    },
  });

  let runnable: Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> =
    streamingModel;

  const sys_message = new SystemMessage(
    `Use the tool you are given to get the answer for custom math operation.`,
  );
  const human_message = new HumanMessage(`What is 2 gamma 2?`);

  if (streamingModel.bindTools) {
    runnable = streamingModel.bindTools([tool]);
  }

  try {
    let containsToolCall = false;
    const stream = await runnable.stream([sys_message, human_message]);
    if (stream) {
      for await (const chunk of stream) {
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          containsToolCall = true;
          break;
        }
      }
      if (containsToolCall) {
        response.supportsToolsInStreaming = true;
        response.supportsTools = true;
        return response;
      }
    }
  } catch (err) {
    console.error(
      "Error when using a streaming client for tool calls, trying a non-streaming client",
      err,
    );
  }

  try {
    // if we're here, model does not support tool calls in streaming
    if (nonStreamingModel.bindTools) {
      runnable = nonStreamingModel.bindTools([tool]);
    }
    const res = await runnable.invoke([sys_message, human_message]);
    if (res.tool_calls && res.tool_calls.length > 0) {
      response.supportsTools = true;
    }
    return response;
  } catch (err) {
    console.error("Error when using a non streaming client for tool calls", err);
  }

  // check if we are connected to the model, this will throw an error if not
  await nonStreamingModel.invoke("a");

  return response;
}
