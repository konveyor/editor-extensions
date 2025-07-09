import { z } from "zod";
import { ChatOllama } from "@langchain/ollama";
import { ChatDeepSeek } from "@langchain/deepseek";
import { AzureChatOpenAI, ChatOpenAI } from "@langchain/openai";
import { ChatBedrockConverse, type ChatBedrockConverseInput } from "@langchain/aws";
import { ChatGoogleGenerativeAI, type GoogleGenerativeAIChatInput } from "@langchain/google-genai";
import {
  type BaseChatModel,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import { type Runnable } from "@langchain/core/runnables";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { type BaseLanguageModelInput } from "@langchain/core/language_models/base";
import { SystemMessage, HumanMessage, type AIMessageChunk } from "@langchain/core/messages";
import { type ChatModelCapabilities, type ChatModelPair } from "@editor-extensions/shared";

import { ModelCreator, ModelClientConfig } from "./types";

// TODO (pgaikwad) - right now, we are returning ChatModelPair as-is, however
// there needs to be another type that exposes invoke, stream methods and internally
// takes care of edge cases that we have already solved in python e.g. bedrock token limit
export class ModelProvider {
  static fromConfig(modelConf: ModelClientConfig): ChatModelPair {
    let modelCreator: ModelCreator;
    switch (modelConf.config.provider) {
      case "AzureChatOpenAI":
        modelCreator = new AzureChatOpenAICreator();
        break;
      case "ChatBedrock":
        modelCreator = new ChatBedrockCreator();
        break;
      case "ChatDeepSeek":
        modelCreator = new ChatDeepSeekCreator();
        break;
      case "ChatGoogleGenerativeAI":
        modelCreator = new ChatGoogleGenerativeAICreator();
        break;
      case "ChatOllama":
        modelCreator = new ChatOllamaCreator();
        break;
      case "ChatOpenAI":
        modelCreator = new ChatOpenAICreator();
        break;
      default:
        throw new Error("Unsupported model provider");
    }
    const defaultArgs = modelCreator.defaultArgs();
    const configArgs = modelConf.config.args;
    //NOTE (pgaikwad) - this overwrites nested properties of defaultargs with configargs
    const args = { ...defaultArgs, ...configArgs };
    modelCreator.validate(args, modelConf.env);
    return {
      streamingModel: modelCreator.create(
        {
          ...args,
          streaming: true,
        },
        modelConf.env,
      ),
      nonStreamingModel: modelCreator.create(
        {
          ...args,
          streaming: false,
        },
        modelConf.env,
      ),
    };
  }
}

class AzureChatOpenAICreator implements ModelCreator {
  create(args: Record<string, any>, env: Record<string, string>): BaseChatModel {
    return new AzureChatOpenAI({
      openAIApiKey: env.AZURE_OPENAI_API_KEY,
      ...args,
    });
  }

  defaultArgs(): Record<string, any> {
    return {
      streaming: true,
      temperature: 0.1,
      maxRetries: 2,
    };
  }

  validate(args: Record<string, any>, env: Record<string, string>): void {
    [
      ["deploymentName", "azureOpenAIApiDeploymentName"],
      ["openAIApiVersion", "azureOpenAIApiVersion"],
    ].forEach((keys) => {
      const hasAtLeastOne = keys.some((key) => key in args);
      if (!hasAtLeastOne) {
        throw new Error(`Missing at least one of required keys: ${keys.join(" or ")}`);
      }
    });

    validateMissingConfigKeys(env, ["AZURE_OPENAI_API_KEY"], "environment variable(s)");
  }
}

class ChatBedrockCreator implements ModelCreator {
  create(args: Record<string, any>, env: Record<string, string>): BaseChatModel {
    const config: ChatBedrockConverseInput = {
      ...args,
      region: env.AWS_DEFAULT_REGION,
    };
    // aws credentials can be specified globally using a credentials file
    if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      };
    }
    return new ChatBedrockConverse(config);
  }

  defaultArgs(): Record<string, any> {
    return {
      streaming: true,
      model: "meta.llama3-70b-instruct-v1:0",
    };
  }

  validate(args: Record<string, any>, _env: Record<string, string>): void {
    validateMissingConfigKeys(args, ["model"], "model arg(s)");
  }
}

class ChatDeepSeekCreator implements ModelCreator {
  create(args: Record<string, any>, env: Record<string, string>): BaseChatModel {
    return new ChatDeepSeek({
      apiKey: env.DEEPSEEK_API_KEY,
      ...args,
    });
  }

  defaultArgs(): Record<string, any> {
    return {
      model: "deepseek-chat",
      streaming: true,
      temperature: 0,
      maxRetries: 2,
    };
  }

  validate(args: Record<string, any>, env: Record<string, string>): void {
    validateMissingConfigKeys(args, ["model"], "model arg(s)");
    validateMissingConfigKeys(env, ["DEEPSEEK_API_KEY"], "environment variable(s)");
  }
}

class ChatGoogleGenerativeAICreator implements ModelCreator {
  create(args: Record<string, any>, env: Record<string, string>): BaseChatModel {
    return new ChatGoogleGenerativeAI({
      apiKey: env.GOOGLE_API_KEY,
      ...args,
    } as GoogleGenerativeAIChatInput);
  }

  defaultArgs(): Record<string, any> {
    return {
      model: "gemini-pro",
      temperature: 0.7,
      streaming: true,
    };
  }

  validate(args: Record<string, any>, env: Record<string, string>): void {
    validateMissingConfigKeys(args, ["model"], "model arg(s)");
    validateMissingConfigKeys(env, ["GOOGLE_API_KEY"], "environment variable(s)");
  }
}

class ChatOllamaCreator implements ModelCreator {
  create(args: Record<string, any>, _: Record<string, string>): BaseChatModel {
    return new ChatOllama({
      ...args,
    });
  }

  defaultArgs(): Record<string, any> {
    return {
      temperature: 0.1,
      streaming: true,
    };
  }

  validate(args: Record<string, any>, _: Record<string, string>): void {
    validateMissingConfigKeys(args, ["model", "baseUrl"], "model arg(s)");
  }
}

class ChatOpenAICreator implements ModelCreator {
  create(args: Record<string, any>, env: Record<string, string>): BaseChatModel {
    return new ChatOpenAI({
      openAIApiKey: env.OPENAI_API_KEY,
      ...args,
    });
  }

  defaultArgs(): Record<string, any> {
    return {
      model: "gpt-4o",
      temperature: 0.1,
      streaming: true,
    };
  }

  validate(args: Record<string, any>, env: Record<string, string>): void {
    validateMissingConfigKeys(args, ["model"], "model arg(s)");
    validateMissingConfigKeys(env, ["OPENAI_API_KEY"], "environment variable(s)");
  }
}

function validateMissingConfigKeys(
  record: Record<string, any>,
  keys: string[],
  name: "environment variable(s)" | "model arg(s)",
): void {
  const missingKeys = keys.filter((k) => !(k in record));
  if (missingKeys && missingKeys.length) {
    throw Error(`Required ${name} missing in model config - ${missingKeys.join(", ")}`);
  }
}
/**
 * Check if the model is connected and supports tools
 * @param modelPair a streaming and non-streaming model pair
 * @returns ChatModelCapabilities
 * @throws Error if the model is not connected
 */
export async function runModelHealthCheck(
  modelPair: ChatModelPair,
): Promise<ChatModelCapabilities> {
  const { streamingModel, nonStreamingModel } = modelPair;
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
