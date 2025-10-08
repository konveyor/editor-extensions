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
  AIMessageChunk,
  type BaseMessage,
  isBaseMessage,
  AIMessage,
} from "@langchain/core/messages";
import {
  FileBasedResponseCache,
  type KaiModelProvider,
  type KaiModelProviderInvokeCallOptions,
} from "@editor-extensions/agentic";

import { type ModelCapabilities } from "./types";
import { isBasePromptValueInterface } from "./utils";

export interface ModelProviderOptions {
  streamingModel: BaseChatModel;
  nonStreamingModel: BaseChatModel;
  capabilities: ModelCapabilities;
  logger: winston.Logger;
  cache: FileBasedResponseCache<BaseLanguageModelInput, BaseMessage>;
  // we use the cache as a tracer but with different directory and serializer/deserializer
  tracer: FileBasedResponseCache<BaseLanguageModelInput, BaseMessage>;
  tools?: BindToolsInput[] | undefined;
  toolKwargs?: Partial<KaiModelProviderInvokeCallOptions> | undefined;
}

// If there are special cases for a model provider, we will add them here
export const ModelProviders: Record<string, (options: ModelProviderOptions) => KaiModelProvider> = {
  ChatBedrock: (options) => new BedrockModelProvider(options),
};

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
  protected readonly streamingModel: BaseChatModel;
  protected readonly nonStreamingModel: BaseChatModel;
  protected readonly capabilities: ModelCapabilities;
  protected readonly logger: winston.Logger;
  protected readonly cache: FileBasedResponseCache<BaseLanguageModelInput, BaseMessage>;
  protected readonly tracer: FileBasedResponseCache<BaseLanguageModelInput, BaseMessage>;
  protected readonly tools: BindToolsInput[] | undefined;
  protected readonly toolKwargs: Partial<KaiModelProviderInvokeCallOptions> | undefined;

  constructor(options: ModelProviderOptions) {
    this.streamingModel = options.streamingModel;
    this.nonStreamingModel = options.nonStreamingModel;
    this.capabilities = options.capabilities;
    this.logger = options.logger;
    this.cache = options.cache;
    this.tracer = options.tracer;
    this.tools = options.tools;
    this.toolKwargs = options.toolKwargs;
  }

  bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<KaiModelProviderInvokeCallOptions>,
  ): KaiModelProvider {
    if (!this.capabilities.supportsTools || !this.nonStreamingModel.bindTools) {
      throw new Error("This model does not support tool calling");
    }
    return new BaseModelProvider({
      streamingModel: this.streamingModel,
      nonStreamingModel: this.nonStreamingModel,
      capabilities: this.capabilities,
      logger: this.logger,
      cache: this.cache,
      tracer: this.tracer,
      tools,
      toolKwargs: kwargs,
    });
  }

  async invoke(
    input: BaseLanguageModelInput,
    options?: Partial<KaiModelProviderInvokeCallOptions> | undefined,
  ): Promise<AIMessage> {
    if (options && options.cacheKey) {
      const cachedResult = await this.cache.get(input, {
        cacheSubDir: options.cacheKey,
      });
      if (cachedResult) {
        return cachedResult;
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
            controller.enqueue(cachedResult);
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
          if (accumulatedResponse && options && options.cacheKey) {
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
          logger.error("Error streaming", { error });
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

/**
 * Bedrock specific model provider to handle output token limits
 */
export class BedrockModelProvider extends BaseModelProvider {
  constructor(options: ModelProviderOptions) {
    super(options);
  }

  bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<KaiModelProviderInvokeCallOptions>,
  ): KaiModelProvider {
    if (!this.capabilities.supportsTools || !this.nonStreamingModel.bindTools) {
      throw new Error("This model does not support tool calling");
    }
    return new BedrockModelProvider({
      streamingModel: this.streamingModel,
      nonStreamingModel: this.nonStreamingModel,
      capabilities: this.capabilities,
      logger: this.logger,
      cache: this.cache,
      tracer: this.tracer,
      tools,
      toolKwargs: kwargs,
    });
  }

  async invoke(
    input: BaseLanguageModelInput,
    options?: Partial<KaiModelProviderInvokeCallOptions> | undefined,
  ): Promise<AIMessage> {
    if (options && options.cacheKey) {
      const cachedResult = await this.cache.get(input, {
        cacheSubDir: options.cacheKey,
      });
      if (cachedResult) {
        return cachedResult;
      }
    }

    let runnable: Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> =
      this.nonStreamingModel;
    if (
      this.capabilities.supportsTools &&
      this.tools &&
      this.tools.length &&
      this.nonStreamingModel.bindTools
    ) {
      runnable = this.nonStreamingModel.bindTools(this.tools, this.toolKwargs);
    }

    const messages: BaseMessage[] = languageModelInputToMessages(input);

    let response = await runnable.invoke(messages, options);

    let maxTokensReached = hitMaxTokens(response);
    let attempts = 10;
    while (maxTokensReached && attempts > 0) {
      this.logger.silly(
        "Max tokens reached during invoke, continuing generation, attempts left: ",
        attempts,
      );
      const newResponse = await runnable.invoke([...messages, response], options);
      response = response.concat(newResponse);
      maxTokensReached = hitMaxTokens(newResponse);
      attempts--;
    }

    if (options && options.cacheKey) {
      this.cache.set(input, response, {
        cacheSubDir: options.cacheKey,
      });
      this.tracer.set(input, response, {
        cacheSubDir: options.cacheKey,
        inputFileExt: "",
        outputFileExt: "",
      });
    }

    return response;
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
            controller.enqueue(cachedResult);
            controller.close();
          },
        }) as IterableReadableStream<any>;
      }
    }

    let runnable: Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> =
      this.streamingModel;
    if (
      this.capabilities.supportsTools &&
      this.tools &&
      this.tools.length &&
      this.streamingModel.bindTools
    ) {
      runnable = this.streamingModel.bindTools(this.tools, this.toolKwargs);
    }

    const originalOptions = options ?? {};
    const optionsWithoutCacheKey = {
      ...originalOptions,
    } as Partial<KaiModelProviderInvokeCallOptions>;
    if ("cacheKey" in optionsWithoutCacheKey) {
      delete optionsWithoutCacheKey.cacheKey;
    }

    const messages: BaseMessage[] = languageModelInputToMessages(input);
    const cache = this.cache;
    const tracer = this.tracer;
    const logger = this.logger;

    return new ReadableStream({
      async start(controller) {
        let accumulatedResponse: AIMessageChunk | undefined;
        let continueStreaming = true;
        let attempts = 10;
        let currentInput: any = messages;
        try {
          while (continueStreaming && attempts > 0) {
            const streamOnce = await runnable.stream(currentInput, optionsWithoutCacheKey);
            for await (const chunk of streamOnce) {
              if (!accumulatedResponse) {
                accumulatedResponse = chunk;
              } else {
                accumulatedResponse = accumulatedResponse.concat(chunk);
              }
              controller.enqueue(chunk);
            }
            if (hitMaxTokens(accumulatedResponse)) {
              attempts--;
              logger.silly(
                "Max tokens reached during streaming, continuing generation, attempts left: ",
                attempts,
              );
              currentInput = [
                ...messages,
                accumulatedResponse,
                new HumanMessage("Continue. Do not repeat."),
              ];
              continueStreaming = true;
            } else {
              continueStreaming = false;
            }
          }
          if (accumulatedResponse && originalOptions.cacheKey) {
            await cache.set(input, accumulatedResponse, {
              cacheSubDir: originalOptions.cacheKey,
            });
            await tracer.set(input, accumulatedResponse, {
              cacheSubDir: originalOptions.cacheKey,
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
}

function hitMaxTokens(chunk: AIMessageChunk | undefined): boolean {
  if (!chunk) {
    return false;
  }
  const extractStopReason = (data: Record<string, any>) => {
    return (
      data &&
      ("messageStop" in data
        ? "stopReason" in data.messageStop
          ? data.messageStop.stopReason
          : undefined
        : undefined)
    );
  };
  return (
    extractStopReason(chunk.response_metadata) === "max_tokens" ||
    extractStopReason(chunk.additional_kwargs) === "max_tokens"
  );
}

function languageModelInputToMessages(input: BaseLanguageModelInput): BaseMessage[] {
  let messages: BaseMessage[];
  if (typeof input === "string") {
    messages = [new HumanMessage(input)];
  } else if (isBasePromptValueInterface(input)) {
    messages = input.toChatMessages();
  } else if (Array.isArray(input)) {
    messages = input
      .map((item) => {
        if (isBaseMessage(item)) {
          return item;
        }
      })
      .filter(Boolean);
  } else {
    messages = input;
  }
  return messages;
}
