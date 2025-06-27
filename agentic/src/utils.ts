import { z } from "zod";
import { fileURLToPath } from "url";
import {
  type BaseChatModel,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { type Runnable } from "@langchain/core/runnables";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { SystemMessage, HumanMessage, type AIMessageChunk } from "@langchain/core/messages";

export async function modelHealthCheck(
  model: BaseChatModel,
): Promise<{ supportsTools: boolean; supportsToolsInStreaming: boolean; connected: boolean }> {
  const response: {
    supportsTools: boolean;
    supportsToolsInStreaming: boolean;
    connected: boolean;
  } = {
    supportsTools: false,
    connected: false,
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

  let runnable: Runnable<BaseLanguageModelInput, AIMessageChunk, BaseChatModelCallOptions> = model;

  const sys_message = new SystemMessage(
    `Use the tool you are given to get the answer for custom math operation.`,
  );
  const human_message = new HumanMessage(`What is 2 gamma 2?`);

  if (model.bindTools) {
    runnable = model.bindTools([tool]);
  }

  try {
    const res = await runnable.invoke([sys_message, human_message]);
    if (res.tool_calls && res.tool_calls.length > 0) {
      response.supportsTools = true;
      try {
        await runnable.stream([sys_message, human_message]);
        response.supportsToolsInStreaming = true;
      } catch (err) {
        console.log(`Model does not support tool calls when streaming - ${err}`);
      }
    }
    response.connected = true;
    return response;
  } catch {
    runnable = runnable.withConfig({ configurable: { streaming: false } });
    try {
      const res = await runnable.invoke([sys_message, human_message]);
      if (res.tool_calls && res.tool_calls.length > 0) {
        response.supportsTools = true;
      }
      response.connected = true;
    } catch {
      try {
        await model.invoke("a");
        response.connected = true;
      } catch (err) {
        throw new Error(
          `Failed to run model healthcheck - ${err instanceof Error ? err.message || String(err) : String(err)}`,
        );
      }
    }
    console.log("Health check response", response);
    return response;
  }
}

/**
 * Removes file:// prefix in URLs passed by vscode extension
 * @param path input path to clean
 */
export function fileUriToPath(path: string): string {
  const cleanPath = path.startsWith("file://") ? fileURLToPath(path) : path;
  return process.platform === "win32" && cleanPath.startsWith("/")
    ? cleanPath.replace("/", "")
    : cleanPath;
}
