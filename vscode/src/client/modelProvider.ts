import { parse } from "yaml";
import { workspace, Uri } from "vscode";
import { ChatOllama } from "@langchain/ollama";
import { ChatDeepSeek } from "@langchain/deepseek";
import { AzureChatOpenAI, ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatBedrockConverseInput, ChatBedrockConverse } from "@langchain/aws";
import { ChatGoogleGenerativeAI, GoogleGenerativeAIChatInput } from "@langchain/google-genai";

import { KaiModelConfig } from "./types";

interface ModelCreator {
  defaultArgs(): Record<string, any>;
  validate(args: Record<string, any>, env: Record<string, string>): void;
  create(args: Record<string, any>, env: Record<string, string>): BaseChatModel;
}

export interface ModelConfig {
  env: Record<string, string>;
  config: KaiModelConfig;
}

// TODO (pgaikwad) - right now, we are returning BaseChatModel as-is, however
// there needs to be another type that exposes invoke, stream methods and internally
// takes care of edge cases that we have already solved in python e.g. bedrock token limit
export class ModelProvider {
  static fromConfig(modelConf: ModelConfig): BaseChatModel {
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
    return modelCreator.create(args, modelConf.env);
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

  validate(args: Record<string, any>, env: Record<string, string>): void {
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

export async function getModelConfig(yamlUri: Uri): Promise<ModelConfig> {
  const yamlFile = await workspace.fs.readFile(yamlUri);
  const yamlString = new TextDecoder("utf8").decode(yamlFile);
  const yamlDoc = parse(yamlString);

  const baseEnv = yamlDoc.environment;
  const { environment, provider, args, template, llamaHeader, llmRetries, llmRetryDelay } =
    yamlDoc.active;

  // TODO: Base sanity checking to make sure a core set of expected fields are
  // TODO: actually defined/referenced in the yaml could go here.

  return {
    env: { ...baseEnv, ...environment },
    config: {
      provider,
      args,
      template,
      llamaHeader,
      llmRetries,
      llmRetryDelay,
    },
  };
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
