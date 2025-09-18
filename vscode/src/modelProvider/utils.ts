import { createHash } from "crypto";
import * as winston from "winston";
import {
  BaseMessage,
  HumanMessage,
  isBaseMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type StoredMessage,
} from "@langchain/core/messages";
import { FileBasedResponseCache } from "@editor-extensions/agentic";
import { type BasePromptValueInterface } from "@langchain/core/prompt_values";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";

export function getCacheForModelProvider(
  enabled: boolean,
  logger: winston.Logger,
  cacheDir: string,
  isTracer: boolean = false,
): FileBasedResponseCache<BaseLanguageModelInput, BaseMessage> {
  return new FileBasedResponseCache<BaseLanguageModelInput, BaseMessage>(
    enabled,
    (data: BaseLanguageModelInput | BaseMessage) =>
      isTracer
        ? prettyPrint(data)
        : JSON.stringify(serializeLLMMessages(data).map(sortKeys), null, 2),
    (data: string) => deserializeLLMMessages(data)[0],
    cacheDir,
    logger,
    (input: BaseLanguageModelInput | BaseMessage) => hashFilteredAndSorted(input),
  );
}

export function deserializeLLMMessages(data: string): BaseMessage[] {
  try {
    const rawParsed = JSON.parse(data);
    if (Array.isArray(rawParsed)) {
      const result = mapStoredMessagesToChatMessages(rawParsed as StoredMessage[]);
      if (result.length === 0) {
        throw new Error("Expected at least one message in the cache file");
      }
      return result;
    }
    throw new Error("Expected an array of messages in the cache file");
  } catch (error) {
    throw new Error(
      `Unable to deserialize cached data: ${error instanceof Error ? error.message : "Invalid JSON"}`,
    );
  }
}

export function serializeLLMMessages(data: BaseLanguageModelInput | BaseMessage): StoredMessage[] {
  if (data instanceof BaseMessage) {
    return mapChatMessagesToStoredMessages([data]);
  }
  if (typeof data === "string") {
    return mapChatMessagesToStoredMessages([new HumanMessage(data)]);
  }
  if (isBasePromptValueInterface(data)) {
    return mapChatMessagesToStoredMessages(data.toChatMessages());
  }
  if (Array.isArray(data)) {
    return mapChatMessagesToStoredMessages(
      data
        .flatMap((item) => {
          if (isBaseMessage(item)) {
            return item;
          } else if (isBasePromptValueInterface(item)) {
            return item.toChatMessages();
          } else if (typeof item === "string") {
            return [new HumanMessage(item)];
          } else {
            return undefined;
          }
        })
        .filter(Boolean),
    );
  }
  return [];
}

export function hashFilteredAndSorted(input: BaseLanguageModelInput | BaseMessage): string {
  return createHash("sha256")
    .update(JSON.stringify(serializeLLMMessages(input).map(filterFields).map(sortKeys)))
    .digest("hex")
    .slice(0, 16);
}

// Sort keys to ensure consistent hash
export function sortKeys(obj: any): any {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  }
  const sortedEntries = Object.entries(obj)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, val]) => [key, sortKeys(val)]);
  return Object.fromEntries(sortedEntries);
}

// Remove fields that change between runs and cause cache misses
export function filterFields<T>(obj: T): T {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(filterFields) as T;
  }
  const keysToRemove = ["created_at", "id", "tool_call_id"];
  const newObj: { [key: string]: any } = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (keysToRemove.includes(key)) {
        continue;
      }
      newObj[key] = filterFields((obj as any)[key]);
    }
  }
  return newObj as T;
}

export function isBasePromptValueInterface(data: unknown): data is BasePromptValueInterface {
  return (
    typeof data === "object" &&
    data !== null &&
    "toString" in data &&
    "toChatMessages" in data &&
    "toJSON" in data
  );
}

function prettyPrint(data: BaseLanguageModelInput | BaseMessage): string {
  return mapStoredMessagesToChatMessages(serializeLLMMessages(data).filter(Boolean))
    .map((m) => {
      let result = `Type: ${m.getType()}`;
      if (m.content) {
        result += `\nContent: ${m.content}`;
      }
      if (Object.keys(m.additional_kwargs).length > 0) {
        result += `\nKwargs: ${JSON.stringify(m.additional_kwargs, null, 2)}`;
      }
      if (m.getType() === "ai" && (m as any).tool_calls && (m as any).tool_calls.length > 0) {
        result += `\nTool Calls: ${JSON.stringify((m as any).tool_calls, null, 2)}`;
      }
      return result;
    })
    .join("\n\n------------------------------\n\n");
}
