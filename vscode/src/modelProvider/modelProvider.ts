import { z } from "zod";
import * as winston from "winston";
import {
  type BindToolsInput,
  type BaseChatModel,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { type Runnable } from "@langchain/core/runnables";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { type IterableReadableStream } from "@langchain/core/utils/stream";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";
import {
  SystemMessage,
  HumanMessage,
  type AIMessageChunk,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  FileBasedResponseCache,
  type KaiModelProvider,
  type KaiModelProviderInvokeCallOptions,
} from "@editor-extensions/agentic";

import { type ModelCapabilities } from "./types";

// If there are special cases for a model provider, we will add them here
export const ModelProviders: Record<string, () => KaiModelProvider> = {};

/**
 * Base model provider class used for providers that do not require any special handling of invoke or stream.
 * Adds helpful functionality on top of base invoke, stream, and bindTools:
 * - Wraps bindTools to return a ModelProvider instance instead of a base runnable
 * - Tells whether the model supports tools and streaming tool calls instead of failing silently
 * @param streamingModel - The streaming model to use
 * @param nonStreamingModel - The non-streaming model to use
 * @param capabilities - The capabilities of the model
 * @param cache - The cache to use
 * @param demoMode - Whether the model is in demo mode
 * @param tools - The tools to use
 * @param toolKwargs - The tool kwargs to use
 */
export class BaseModelProvider implements KaiModelProvider {
  constructor(
    private readonly streamingModel: BaseChatModel,
    private readonly nonStreamingModel: BaseChatModel,
    private readonly capabilities: ModelCapabilities,
    private readonly logger: winston.Logger,
    private readonly cache: FileBasedResponseCache<BaseLanguageModelInput, BaseMessage>,
    // we use the cache as a tracer but with different directory and serializer/deserializer
    private readonly tracer: FileBasedResponseCache<BaseLanguageModelInput, BaseMessage>,
    private readonly tools: BindToolsInput[] | undefined = undefined,
    private readonly toolKwargs: Partial<KaiModelProviderInvokeCallOptions> | undefined = undefined,
  ) {}

  bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<KaiModelProviderInvokeCallOptions>,
  ): KaiModelProvider {
    if (!this.capabilities.supportsTools || !this.nonStreamingModel.bindTools) {
      throw new Error("This model does not support tool calling");
    }
    return new BaseModelProvider(
      this.streamingModel,
      this.nonStreamingModel,
      this.capabilities,
      this.logger,
      this.cache,
      this.tracer,
      tools,
      kwargs,
    );
  }

  async invoke(
    input: BaseLanguageModelInput,
    options?: Partial<KaiModelProviderInvokeCallOptions> | undefined,
  ): Promise<AIMessageChunk> {
    if (options && options.cacheKey) {
      const cachedResult = await this.cache.get(input, {
        cacheSubDir: options.cacheKey,
      });
      if (cachedResult) {
        return cachedResult as AIMessageChunk;
      }
    }

    let result: AIMessageChunk;
    if (
      this.capabilities.supportsTools &&
      this.tools &&
      this.tools.length &&
      this.nonStreamingModel.bindTools
    ) {
      result = await this.nonStreamingModel
        .bindTools(this.tools, this.toolKwargs)
        .invoke(input, options);
    } else {
      result = await this.nonStreamingModel.invoke(input, options);
    }
    if (options && options.cacheKey) {
      this.cache.set(input, result, {
        cacheSubDir: options.cacheKey,
      });
      this.tracer.set(input, result, {
        cacheSubDir: options.cacheKey,
        inputFileExt: "",
        outputFileExt: "",
      });
    }
    return result;
  }

  async stream(
    input: any,
    options?: Partial<KaiModelProviderInvokeCallOptions> | undefined,
  ): Promise<IterableReadableStream<any>> {
    if (options && options.cacheKey) {
      const cachedResult = await this.cache.get(input, {
        cacheSubDir: options.cacheKey,
      });
      if (cachedResult) {
        return new ReadableStream({
          start(controller) {
            controller.enqueue(cachedResult as AIMessageChunk);
            controller.close();
          },
        }) as IterableReadableStream<any>;
      }
    }

    // Get the actual stream from the underlying model
    let actualStream: IterableReadableStream<any>;
    if (
      this.capabilities.supportsToolsInStreaming &&
      this.tools &&
      this.tools.length &&
      this.streamingModel.bindTools
    ) {
      actualStream = await this.streamingModel
        .bindTools(this.tools, this.toolKwargs)
        .stream(input, options);
    } else {
      actualStream = await this.streamingModel.stream(input, options);
    }

    // If no caching is needed, return the stream as-is
    if (!options || !options.cacheKey) {
      return actualStream;
    }

    let accumulatedResponse: AIMessageChunk | undefined;
    const cache = this.cache;
    const tracer = this.tracer;
    const logger = this.logger;
    return new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of actualStream) {
            if (!accumulatedResponse) {
              accumulatedResponse = chunk;
            } else {
              accumulatedResponse = accumulatedResponse.concat(chunk);
            }
            controller.enqueue(chunk);
          }
          if (accumulatedResponse && options.cacheKey) {
            await cache.set(input, accumulatedResponse, {
              cacheSubDir: options.cacheKey,
            });
            await tracer.set(input, accumulatedResponse, {
              cacheSubDir: options.cacheKey,
              inputFileExt: "",
              outputFileExt: "",
            });
          }
          controller.close();
        } catch (error) {
          logger.error(`Error streaming: ${error}`);
          controller.error(error);
        }
      },
    }) as IterableReadableStream<any>;
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
): Promise<ModelCapabilities> {
  const response: ModelCapabilities = {
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
