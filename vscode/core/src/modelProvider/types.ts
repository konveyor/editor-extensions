import { type BaseChatModel } from "@langchain/core/language_models/chat_models";

export type SupportedModelProviders =
  | "AzureChatOpenAI"
  | "ChatBedrock"
  | "ChatDeepSeek"
  | "ChatGoogleGenerativeAI"
  | "ChatOllama"
  | "ChatOpenAI";

export const PROVIDER_ENV_CA_BUNDLE = "CA_BUNDLE";
export const PROVIDER_ENV_INSECURE = "ALLOW_INSECURE";

/**
 * The config for a model. This is parsed from the yaml file and contains args as-is.
 */
export interface KaiModelConfig {
  provider: SupportedModelProviders;
  args: Record<string, any>;
  template?: string;
  llamaHeader?: boolean;
  llmRetries?: number;
  llmRetryDelay?: number;
}

/**
 * This is the config and environment variables combined used by the model provider to create a model client.
 */
export interface ParsedModelConfig {
  env: Record<string, string>;
  config: KaiModelConfig;
}

export interface ModelCreator {
  defaultArgs(): Record<string, any>;
  validate(args: Record<string, any>, env: Record<string, string>): void;
  create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel>;
}

export type FetchFn = (input: Request | URL | string, init?: RequestInit) => Promise<Response>;

export interface ModelCapabilities {
  supportsTools: boolean;
  supportsToolsInStreaming: boolean;
}
