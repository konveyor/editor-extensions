import { Logger } from "winston";
import { ChatOllama } from "@langchain/ollama";
import { ChatDeepSeek } from "@langchain/deepseek";
import { AzureChatOpenAI, ChatOpenAI } from "@langchain/openai";
import { ChatBedrockConverse, type ChatBedrockConverseInput } from "@langchain/aws";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { ChatGoogleGenerativeAI, type GoogleGenerativeAIChatInput } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

import {
  getDispatcherWithCertBundle,
  getFetchWithDispatcher,
  getNodeHttpHandler,
} from "../utilities/tls";
import { ModelCreator, PROVIDER_ENV_CA_BUNDLE, PROVIDER_ENV_INSECURE, type FetchFn } from "./types";
import { getConfigHttpProtocol } from "../utilities/httpProtocol";

export const ModelCreators: Record<string, (logger: Logger) => ModelCreator> = {
  AzureChatOpenAI: (logger) => new AzureChatOpenAICreator(logger),
  ChatBedrock: (logger) => new ChatBedrockCreator(logger),
  ChatDeepSeek: (logger) => new ChatDeepSeekCreator(logger),
  ChatGoogleGenerativeAI: (logger) => new ChatGoogleGenerativeAICreator(logger),
  ChatOllama: (logger) => new ChatOllamaCreator(logger),
  ChatOpenAI: (logger) => new ChatOpenAICreator(logger),
};

class AzureChatOpenAICreator implements ModelCreator {
  constructor(private readonly logger: Logger) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    const httpProtocol = getConfigHttpProtocol();
    const allowH2 = httpProtocol === "http2";
    const fetchFn = await getFetchFn(env, this.logger, allowH2);
    return new AzureChatOpenAI({
      openAIApiKey: env.AZURE_OPENAI_API_KEY,
      ...args,
      configuration: {
        ...args.configuration,
        ...(fetchFn ? { fetch: fetchFn } : {}),
      },
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
  constructor(private readonly logger: Logger) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    const httpProtocol = getConfigHttpProtocol();

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

    const httpVersion = httpProtocol === "http2" ? "2.0" : "1.1";
    const requestHandler = await getNodeHttpHandler(env, this.logger, httpVersion);
    const runtimeClient = new BedrockRuntimeClient({
      region: env.AWS_DEFAULT_REGION,
      credentials: config.credentials,
      requestHandler,
    });
    config.client = runtimeClient;

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
  constructor(private readonly logger: Logger) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    const httpProtocol = getConfigHttpProtocol();
    const allowH2 = httpProtocol === "http2";
    const fetchFn = await getFetchFn(env, this.logger, allowH2);
    return new ChatDeepSeek({
      apiKey: env.DEEPSEEK_API_KEY,
      ...args,
      configuration: {
        ...args.configuration,
        ...(fetchFn ? { fetch: fetchFn } : {}),
      },
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
  constructor(private readonly logger: Logger) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
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
  constructor(private readonly logger: Logger) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    const httpProtocol = getConfigHttpProtocol();
    const allowH2 = httpProtocol === "http2";
    const fetchFn = await getFetchFn(env, this.logger, allowH2);
    return new ChatOllama({
      ...args,
      ...(fetchFn ? { fetch: fetchFn } : {}),
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
  constructor(private readonly logger: Logger) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    const httpProtocol = getConfigHttpProtocol();
    const allowH2 = httpProtocol === "http2";
    const fetchFn = await getFetchFn(env, this.logger, allowH2);
    return new ChatOpenAI({
      apiKey: env.OPENAI_API_KEY,
      ...args,
      configuration: {
        ...args.configuration,
        ...(fetchFn ? { fetch: fetchFn } : {}),
      },
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
  let missingKeys = keys.filter((k) => !(k in record));
  if (name === "environment variable(s)") {
    missingKeys = missingKeys.filter((key) => !(key in process.env));
  }
  if (missingKeys && missingKeys.length) {
    throw Error(
      `Required ${name} missing in model config${name === "environment variable(s)" ? " or environment " : ""}- ${missingKeys.join(", ")}`,
    );
  }
}

function getCaBundleAndInsecure(env: Record<string, string>): {
  caBundle: string;
  insecure: boolean;
} {
  const caBundle = env[PROVIDER_ENV_CA_BUNDLE];
  const insecureRaw = env[PROVIDER_ENV_INSECURE];
  let insecure = false;
  if (insecureRaw && insecureRaw.match(/^(true|1)$/i)) {
    insecure = true;
  }
  return { caBundle, insecure };
}

async function getFetchFn(
  env: Record<string, string>,
  logger: Logger,
  allowH2: boolean = false,
): Promise<FetchFn | undefined> {
  const { caBundle, insecure } = getCaBundleAndInsecure(env);
  const needsCustomDispatcher = caBundle || insecure || !allowH2;

  if (needsCustomDispatcher) {
    try {
      const dispatcher = await getDispatcherWithCertBundle(caBundle, insecure, allowH2, logger);
      return getFetchWithDispatcher(dispatcher);
    } catch (error) {
      logger.error(error);
      throw new Error(`Failed to setup dispatcher: ${String(error)}`);
    }
  }

  return undefined;
}
