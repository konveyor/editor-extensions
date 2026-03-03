import { v4 as uuidv4 } from "uuid";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  isBaseMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { BindToolsInput } from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { IterableReadableStream } from "@langchain/core/utils/stream";
import type {
  KaiModelProvider,
  KaiModelProviderInvokeCallOptions,
} from "@editor-extensions/agentic";
import type { GooseClient } from "../../client/gooseClient";
import type { GooseContentBlockType } from "@editor-extensions/shared";
import type { Logger } from "winston";

/**
 * KaiModelProvider adapter that routes LLM calls through the Goose agent.
 *
 * The existing KaiInteractiveWorkflow and its LangGraph nodes remain unchanged;
 * only the underlying LLM is swapped. Goose receives the same prompts that would
 * go to a direct LLM and returns text responses in the same format.
 */
export class GooseModelProvider implements KaiModelProvider {
  constructor(
    private readonly gooseClient: GooseClient,
    private readonly logger: Logger,
  ) {}

  toolCallsSupported(): boolean {
    return false;
  }

  toolCallsSupportedInStreaming(): boolean {
    return false;
  }

  bindTools(
    _tools: BindToolsInput[],
    _kwargs?: Partial<KaiModelProviderInvokeCallOptions>,
  ): KaiModelProvider {
    // Goose manages its own tools internally. The workflow nodes will fall back
    // to text-based tool descriptions when toolCallsSupported() returns false.
    return this;
  }

  async invoke(
    input: BaseLanguageModelInput,
    _options?: KaiModelProviderInvokeCallOptions,
  ): Promise<AIMessage> {
    const prompt = inputToText(input);
    const messageId = uuidv4();

    const chunks: string[] = [];

    const onChunk = (_msgId: string, content: string, contentType: GooseContentBlockType): void => {
      if (contentType === "text" && content) {
        chunks.push(content);
      }
    };

    this.gooseClient.on("streamingChunk", onChunk);
    try {
      await this.gooseClient.sendMessage(prompt, messageId);
    } finally {
      this.gooseClient.removeListener("streamingChunk", onChunk);
    }

    return new AIMessage({ content: chunks.join("") });
  }

  async stream(
    input: BaseLanguageModelInput,
    _options?: Partial<KaiModelProviderInvokeCallOptions>,
  ): Promise<IterableReadableStream<AIMessageChunk>> {
    const prompt = inputToText(input);
    const messageId = uuidv4();

    const gooseClient = this.gooseClient;
    const logger = this.logger;

    return new ReadableStream<AIMessageChunk>({
      start(controller) {
        const onChunk = (
          _msgId: string,
          content: string,
          contentType: GooseContentBlockType,
        ): void => {
          if (contentType === "text" && content) {
            controller.enqueue(new AIMessageChunk({ content }));
          }
        };

        const onComplete = (_msgId: string): void => {
          cleanup();
          controller.close();
        };

        const onError = (err: Error): void => {
          cleanup();
          controller.error(err);
        };

        const cleanup = (): void => {
          gooseClient.removeListener("streamingChunk", onChunk);
          gooseClient.removeListener("streamingComplete", onComplete);
          gooseClient.removeListener("error", onError);
        };

        gooseClient.on("streamingChunk", onChunk);
        gooseClient.on("streamingComplete", onComplete);
        gooseClient.on("error", onError);

        gooseClient.sendMessage(prompt, messageId).catch((err) => {
          logger.error("GooseModelProvider stream error", { error: err });
          cleanup();
          try {
            controller.error(err);
          } catch {
            // controller may already be closed
          }
        });
      },
    }) as IterableReadableStream<AIMessageChunk>;
  }
}

function inputToText(input: BaseLanguageModelInput): string {
  if (typeof input === "string") {
    return input;
  }

  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (!isBaseMessage(item)) {
          return String(item);
        }
        const content =
          typeof item.content === "string" ? item.content : JSON.stringify(item.content);
        if (item instanceof SystemMessage) {
          return `[System]\n${content}`;
        }
        if (item instanceof HumanMessage) {
          return content;
        }
        if (item instanceof AIMessage || item instanceof AIMessageChunk) {
          return `[Assistant]\n${content}`;
        }
        return content;
      })
      .join("\n\n");
  }

  if (typeof (input as any).toChatMessages === "function") {
    const messages: BaseMessage[] = (input as any).toChatMessages();
    return inputToText(messages);
  }

  return String(input);
}
