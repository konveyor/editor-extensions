import { Logger } from "winston";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { ChatOllama } from "@langchain/ollama";
import { ChatAnthropic } from "@langchain/anthropic";
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
  resolveProxyEnv,
} from "../utilities/tls";
import { ModelCreator, PROVIDER_ENV_CA_BUNDLE, PROVIDER_ENV_INSECURE, type FetchFn } from "./types";
import { getConfigHttpProtocol } from "../utilities/httpProtocol";
import { sanitizeUrl } from "../utilities/networkDiagnostics";

const defaultDispatcher = getGlobalDispatcher();
const originalFetch = globalThis.fetch;

/**
 * `providerEnv` is the raw `environment:` block from provider-settings.yaml,
 * kept separate from the merged environment so proxy settings can tell an
 * explicit user override (including an empty value) apart from an inherited
 * process variable.
 */
export const ModelCreators: Record<
  string,
  (logger: Logger, providerEnv?: Record<string, string>) => ModelCreator
> = {
  AzureChatOpenAI: (logger, providerEnv) => new AzureChatOpenAICreator(logger, providerEnv),
  ChatAnthropic: (logger, providerEnv) => new ChatAnthropicCreator(logger, providerEnv),
  ChatBedrock: (logger, providerEnv) => new ChatBedrockCreator(logger, providerEnv),
  ChatDeepSeek: (logger, providerEnv) => new ChatDeepSeekCreator(logger, providerEnv),
  ChatGoogleGenerativeAI: (logger, providerEnv) =>
    new ChatGoogleGenerativeAICreator(logger, providerEnv),
  ChatOllama: (logger, providerEnv) => new ChatOllamaCreator(logger, providerEnv),
  ChatOpenAI: (logger, providerEnv) => new ChatOpenAICreator(logger, providerEnv),
};

class AzureChatOpenAICreator implements ModelCreator {
  constructor(
    private readonly logger: Logger,
    private readonly providerEnv: Record<string, string> = {},
  ) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    const fetchFn = await setupProviderTLS(
      env,
      this.logger,
      extractProviderTargetUrl(args),
      this.providerEnv,
    );
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

class ChatAnthropicCreator implements ModelCreator {
  constructor(
    private readonly logger: Logger,
    private readonly providerEnv: Record<string, string> = {},
  ) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    const fetchFn = await setupProviderTLS(env, this.logger, undefined, this.providerEnv);
    return new ChatAnthropic({
      apiKey: env.ANTHROPIC_API_KEY,
      ...args,
      clientOptions: {
        ...args.clientOptions,
        ...(fetchFn ? { fetch: fetchFn } : {}),
      },
    });
  }

  defaultArgs(): Record<string, any> {
    // NOTE: sampling params (temperature/top_p/top_k) are rejected with a 400 by
    // current Claude models (Sonnet 5, Opus 4.7/4.8, ...), so we don't default
    // temperature here the way the OpenAI-family providers do.
    return {
      model: "claude-sonnet-5",
      streaming: true,
      maxRetries: 2,
    };
  }

  validate(args: Record<string, any>, env: Record<string, string>): void {
    validateMissingConfigKeys(args, ["model"], "model arg(s)");
    validateMissingConfigKeys(env, ["ANTHROPIC_API_KEY"], "environment variable(s)");
  }
}

class ChatBedrockCreator implements ModelCreator {
  constructor(
    private readonly logger: Logger,
    private readonly providerEnv: Record<string, string> = {},
  ) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    const bedrockEndpoint =
      extractProviderTargetUrl(args) ||
      (env.AWS_DEFAULT_REGION
        ? `https://bedrock-runtime.${env.AWS_DEFAULT_REGION}.amazonaws.com`
        : undefined);

    await setupProviderTLS(env, this.logger, bedrockEndpoint, this.providerEnv);

    const config: ChatBedrockConverseInput = {
      ...args,
      region: env.AWS_DEFAULT_REGION,
    };
    if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      };
    }

    const httpProtocol = getConfigHttpProtocol();
    const httpVersion = httpProtocol === "http2" ? "2.0" : "1.1";
    const requestHandler = await getNodeHttpHandler(
      env,
      this.logger,
      httpVersion,
      bedrockEndpoint,
      this.providerEnv,
    );
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
  constructor(
    private readonly logger: Logger,
    private readonly providerEnv: Record<string, string> = {},
  ) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    const fetchFn = await setupProviderTLS(
      env,
      this.logger,
      extractProviderTargetUrl(args),
      this.providerEnv,
    );
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
  constructor(
    private readonly logger: Logger,
    private readonly providerEnv: Record<string, string> = {},
  ) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    await setupProviderTLS(env, this.logger, extractProviderTargetUrl(args), this.providerEnv);
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
  constructor(
    private readonly logger: Logger,
    private readonly providerEnv: Record<string, string> = {},
  ) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    const fetchFn = await setupProviderTLS(
      env,
      this.logger,
      extractProviderTargetUrl(args),
      this.providerEnv,
    );
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
  constructor(
    private readonly logger: Logger,
    private readonly providerEnv: Record<string, string> = {},
  ) {}

  async create(args: Record<string, any>, env: Record<string, string>): Promise<BaseChatModel> {
    const fetchFn = await setupProviderTLS(
      env,
      this.logger,
      extractProviderTargetUrl(args),
      this.providerEnv,
    );
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

/**
 * Unified TLS setup for all model providers.
 *
 * Webpack bundles our `undici` dependency into the extension, creating a
 * separate instance from Node's built-in undici (`node:internal/deps/undici`).
 * `setGlobalDispatcher()` only configures the bundled copy, but
 * `globalThis.fetch` in Node 22+ is powered by Node's built-in copy —
 * so SDKs like Google GenAI that call `globalThis.fetch` bypass our
 * dispatcher entirely. We must also override `globalThis.fetch` with our
 * bundled undici's fetch to ensure custom CA certs are used.
 */
/**
 * Pulls a likely target URL out of a model provider's `args` so the TLS
 * dispatcher can evaluate `NO_PROXY` against it. Returns `undefined` if the
 * provider's endpoint isn't expressed in the args (cloud SDKs that resolve
 * their endpoint internally) — in which case proxy behavior falls back to
 * the historical "always use the proxy if one is set" path.
 */
export function extractProviderTargetUrl(
  args: Record<string, any> | undefined,
): string | undefined {
  if (!args) {
    return undefined;
  }
  return (
    args.configuration?.baseURL ||
    args.configuration?.basePath ||
    args.baseUrl ||
    args.baseURL ||
    args.endpoint ||
    args.endpointUrl ||
    args.azureOpenAIEndpoint ||
    undefined
  );
}

export interface ProviderDispatchPlan {
  /** Whether global routing needs the bundled undici dispatcher at all. */
  needsGlobalDispatcher: boolean;
  /** Whether the model client needs its own dispatcher, separate from the global one. */
  scopeToModelClient: boolean;
}

/**
 * Decide how a provider's connection should be dispatched.
 *
 * Global routing is derived from the *process* environment alone. It is shared
 * with everything else in the extension host - notably Hub auth and token
 * refresh, which only use a scoped fetch in insecure mode - so provider
 * settings must not influence it in either direction. Disabling the proxy for
 * the model must not disable it for the Hub, and pointing the model at a
 * different proxy must not repoint the Hub.
 *
 * A proxy forces the custom dispatcher: undici does not read proxy environment
 * variables on its own, so skipping it would drop the proxy and connect
 * directly. Previously only HTTP/1 forced one, which meant HTTP/2 with default
 * TLS silently ignored any configured proxy.
 *
 * The model needs its own dispatcher whenever provider settings decided its
 * routing; otherwise it can share the global one, whose routing already
 * matches.
 */
export function planProviderDispatch(input: {
  caBundle?: string;
  insecure: boolean;
  allowH2: boolean;
  /** Proxy resolved from the process environment only. */
  processProxyUrl?: string;
  /** True when provider-settings.yaml defined any proxy variable. */
  fromProviderEnv: boolean;
}): ProviderDispatchPlan {
  return {
    needsGlobalDispatcher:
      !!input.caBundle || input.insecure || !input.allowH2 || !!input.processProxyUrl,
    scopeToModelClient: input.fromProviderEnv,
  };
}

export async function setupProviderTLS(
  env: Record<string, string>,
  logger: Logger,
  targetUrl?: string,
  providerEnv?: Record<string, string>,
): Promise<FetchFn | undefined> {
  const httpProtocol = getConfigHttpProtocol();
  const allowH2 = httpProtocol === "http2";
  const { caBundle, insecure } = getCaBundleAndInsecure(env);

  const providerProxy = resolveProxyEnv(providerEnv);
  // Resolved without the provider env so global routing stays independent.
  const processProxy = resolveProxyEnv();

  const { needsGlobalDispatcher, scopeToModelClient } = planProviderDispatch({
    caBundle,
    insecure,
    allowH2,
    processProxyUrl: processProxy.proxyUrl,
    fromProviderEnv: providerProxy.fromProviderEnv,
  });

  logger.info("Provider TLS config", {
    caBundle: caBundle ? `set (${caBundle})` : "not set",
    insecure,
    httpProtocol,
    needsGlobalDispatcher,
    scopeToModelClient,
    hasProxy: !!providerProxy.proxyUrl,
    proxyUrl: providerProxy.proxyUrl ? sanitizeUrl(providerProxy.proxyUrl) : "none",
    // Log the resolved bypass list, not just whether one exists - a NO_PROXY
    // that simply omits the target host is indistinguishable from a missing
    // one otherwise, and that ambiguity is what makes these reports expensive.
    noProxy: providerProxy.noProxy ?? "none",
    proxySource: providerProxy.fromProviderEnv ? "provider-settings" : "process-environment",
    globalProxyUrl: processProxy.proxyUrl ? sanitizeUrl(processProxy.proxyUrl) : "none",
    globalNoProxy: processProxy.noProxy ?? "none",
    targetUrl: targetUrl ? sanitizeUrl(targetUrl) : "none",
    envKeys: Object.keys(env),
  });

  try {
    // 1. Global routing, from the process environment only. Built without a
    //    target URL, so `getDispatcherWithCertBundle` returns a dispatcher
    //    that evaluates NO_PROXY per request destination rather than
    //    proxying everything.
    let globalFetch: FetchFn | undefined;
    if (needsGlobalDispatcher) {
      const globalDispatcher = await getDispatcherWithCertBundle(
        caBundle,
        insecure,
        allowH2,
        logger,
        undefined,
      );
      globalFetch = getFetchWithDispatcher(globalDispatcher);
      setGlobalDispatcher(globalDispatcher as any);
      globalThis.fetch = globalFetch as typeof globalThis.fetch;
    } else {
      setGlobalDispatcher(defaultDispatcher);
      globalThis.fetch = originalFetch;
    }

    // 2. The model client's own fetch. Only needed when provider settings
    //    chose different routing; otherwise the global dispatcher already
    //    routes this destination correctly.
    if (!scopeToModelClient) {
      return globalFetch;
    }

    logger.info(
      "Provider proxy settings came from provider-settings.yaml; scoping them to model client requests",
    );
    const modelDispatcher = await getDispatcherWithCertBundle(
      caBundle,
      insecure,
      allowH2,
      logger,
      targetUrl,
      providerEnv,
    );
    return getFetchWithDispatcher(modelDispatcher);
  } catch (error) {
    logger.error(error);
    throw new Error(`Failed to setup TLS dispatcher: ${String(error)}`);
  }
}
