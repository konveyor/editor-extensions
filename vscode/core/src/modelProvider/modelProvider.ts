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
import { renderPrompt } from "@editor-extensions/prompts";

import { type ModelCapabilities } from "./types";
import { isBasePromptValueInterface } from "./utils";
import { describeErrorChain } from "../utilities/networkDiagnostics";

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
        return cachedResult as AIMessage;
      }
    }

    // Strip cacheKey before passing to the underlying model - it's not a valid LangChain option
    const modelOptions = options ? stripCacheKey(options) : undefined;

    let result: AIMessageChunk;
    if (
      this.capabilities.supportsTools &&
      this.tools &&
      this.tools.length &&
      this.nonStreamingModel.bindTools
    ) {
      result = await this.nonStreamingModel
        .bindTools(this.tools, this.toolKwargs)
        .invoke(input, modelOptions);
    } else {
      result = await this.nonStreamingModel.invoke(input, modelOptions);
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

    // Strip cacheKey before passing to the underlying model - it's not a valid LangChain option
    const modelOptions = options ? stripCacheKey(options) : undefined;

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
        .stream(input, modelOptions);
    } else {
      actualStream = await this.streamingModel.stream(input, modelOptions);
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
 * Default budget for the whole health check. Without an explicit timeout a
 * blackholed connection (a proxy that accepts the TCP connection and then
 * drops the request) stalls on undici's 300s default `headersTimeout`, so
 * provider initialization hangs for five minutes with no feedback.
 */
export const MODEL_HEALTH_CHECK_TIMEOUT_MS = 30_000;

export interface ModelHealthCheckOptions {
  logger?: winston.Logger;
  /** Total budget shared across every probe, not per-request. */
  timeoutMs?: number;
}

export class ModelHealthCheckTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Model health check exceeded its ${timeoutMs}ms budget. The endpoint accepted the ` +
        `connection but did not respond in time - check the provider URL, proxy settings, and ` +
        `that the model server is reachable.`,
    );
    this.name = "ModelHealthCheckTimeoutError";
  }
}

/**
 * Run `work` under a hard deadline.
 *
 * The per-call `timeout` option is forwarded to providers as a courtesy, but
 * it cannot be relied on: several LangChain integrations do not plumb the
 * abort signal all the way down. `@langchain/ollama`, for instance, awaits
 * `client.chat()` with no signal and only checks `signal.aborted` after a
 * chunk has already arrived, so a server that accepts the connection and
 * stays silent is never bounded. Racing against a timer guarantees the budget
 * holds regardless of SDK behavior; the abort signal still lets well-behaved
 * clients release the underlying socket instead of leaking it.
 */
async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  budgetMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ModelHealthCheckTimeoutError(budgetMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work(controller.signal), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if the model is connected and supports tools
 * @param streamingModel a streaming model
 * @param nonStreamingModel a non-streaming model
 * @param options optional logger and overall timeout budget
 * @returns ChatModelCapabilities
 * @throws Error if the model is not connected
 */
export async function runModelHealthCheck(
  streamingModel: BaseChatModel,
  nonStreamingModel: BaseChatModel,
  options: ModelHealthCheckOptions = {},
): Promise<ModelCapabilities> {
  const { logger, timeoutMs = MODEL_HEALTH_CHECK_TIMEOUT_MS } = options;

  // The three probes below run in sequence, so give them a shared deadline
  // rather than a per-request timeout - otherwise the worst case is 3x.
  const deadline = Date.now() + timeoutMs;

  // Once the budget is gone, fail rather than granting each remaining probe a
  // fresh floor; a floor would let a stalled endpoint overrun the budget.
  const runProbe = <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return Promise.reject(new ModelHealthCheckTimeoutError(timeoutMs));
    }
    return withDeadline(work, remaining, timeoutMs);
  };

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

  const sys_message = new SystemMessage(renderPrompt("operational.model-health-check.system", {}));
  const human_message = new HumanMessage(renderPrompt("operational.model-health-check.human", {}));

  if (streamingModel.bindTools) {
    runnable = streamingModel.bindTools([tool]);
  }

  try {
    // Bound stream creation *and* consumption together. Bounding only the
    // former leaves a server that opens the stream and then stalls unbounded.
    const containsToolCall = await runProbe(async (signal) => {
      const stream = await runnable.stream([sys_message, human_message], {
        timeout: deadline - Date.now(),
        signal,
      });
      if (!stream) {
        return false;
      }
      for await (const chunk of stream) {
        if (chunk.tool_calls && chunk.tool_calls.length > 0) {
          return true;
        }
      }
      return false;
    });

    if (containsToolCall) {
      response.supportsToolsInStreaming = true;
      response.supportsTools = true;
      return response;
    }
  } catch (err) {
    if (err instanceof ModelHealthCheckTimeoutError) {
      throw err;
    }
    // Expected when the server does not support tool calls while streaming
    // (vLLM without `--enable-auto-tool-choice`, for example). Log through the
    // logger rather than the console so it lands in the debug archive - this is
    // the only record of why `supportsTools` ends up false.
    logger?.info("Streaming client could not use tool calls, trying a non-streaming client", {
      error: describeErrorChain(err),
    });
  }

  try {
    // if we're here, model does not support tool calls in streaming
    if (nonStreamingModel.bindTools) {
      runnable = nonStreamingModel.bindTools([tool]);
    }
    const res = await runProbe((signal) =>
      runnable.invoke([sys_message, human_message], {
        timeout: deadline - Date.now(),
        signal,
      }),
    );
    if (res.tool_calls && res.tool_calls.length > 0) {
      response.supportsTools = true;
    }
    return response;
  } catch (err) {
    if (err instanceof ModelHealthCheckTimeoutError) {
      throw err;
    }
    logger?.info("Non-streaming client could not use tool calls", {
      error: describeErrorChain(err),
    });
  }

  // check if we are connected to the model, this will throw an error if not
  await runProbe((signal) =>
    nonStreamingModel.invoke("a", { timeout: deadline - Date.now(), signal }),
  );

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
        return cachedResult as AIMessage;
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

function stripCacheKey(
  options: Partial<KaiModelProviderInvokeCallOptions>,
): Partial<KaiModelProviderInvokeCallOptions> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { cacheKey, ...rest } = options;
  return rest;
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
