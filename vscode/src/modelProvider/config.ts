import { parse } from "yaml";
import * as pathlib from "path";
import * as winston from "winston";
import { workspace, Uri } from "vscode";
import { AIMessage } from "@langchain/core/messages";
import { KaiModelProvider } from "@editor-extensions/agentic";

import { type ModelCapabilities, ParsedModelConfig } from "./types";
import { ModelCreators } from "./modelCreator";
import { getCacheForModelProvider } from "./utils";
import { getTraceEnabled, getConfigKaiDemoMode } from "../utilities/configuration";
import { BaseModelProvider, ModelProviders, runModelHealthCheck } from "./modelProvider";

export async function parseModelConfig(yamlUri: Uri): Promise<ParsedModelConfig> {
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

/**
 * Returns a flat list of all key-values in the environment and config objects. Used to create debug archive.
 */
export function getProviderConfigKeys(
  parsedConfig: ParsedModelConfig,
): Array<{ key: string; value: any }> {
  const flattenObject = (obj: any, prefix: string = ""): Array<{ key: string; value: any }> => {
    const keyValuePairs: Array<{ key: string; value: any }> = [];
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (obj[key] !== null && typeof obj[key] === "object" && !Array.isArray(obj[key])) {
          keyValuePairs.push(...flattenObject(obj[key], fullKey));
        } else {
          // Add the leaf key and value
          keyValuePairs.push({ key: fullKey, value: obj[key] });
        }
      }
    }
    return keyValuePairs;
  };
  const envKeyValues = flattenObject(parsedConfig.env, "env");
  const configKeyValues = flattenObject(parsedConfig.config, "config");
  return [...envKeyValues, ...configKeyValues];
}

export async function getModelProviderFromConfig(
  parsedConfig: ParsedModelConfig,
  logger: winston.Logger,
  cacheDir: string | undefined = undefined,
  traceDir: string | undefined = undefined,
): Promise<KaiModelProvider> {
  if (!ModelCreators[parsedConfig.config.provider]) {
    throw new Error("Unsupported model provider");
  }

  const processEnvFiltered = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
  const mergedEnv = { ...processEnvFiltered, ...parsedConfig.env };

  const modelCreator = ModelCreators[parsedConfig.config.provider]();
  const defaultArgs = modelCreator.defaultArgs();
  const configArgs = parsedConfig.config.args;
  //NOTE (pgaikwad) - this overwrites nested properties of defaultargs with configargs
  const args = { ...defaultArgs, ...configArgs };
  modelCreator.validate(args, mergedEnv);
  const streamingModel = modelCreator.create(
    {
      ...args,
      streaming: true,
    },
    mergedEnv,
  );
  const nonStreamingModel = modelCreator.create(
    {
      ...args,
      streaming: false,
    },
    mergedEnv,
  );

  const subDir = (dir: string): string =>
    pathlib.join(
      dir,
      parsedConfig.config.provider,
      (parsedConfig.config.args.model ?? parsedConfig.config.args.model_id ?? "").replace(
        /[^a-zA-Z0-9_-]/g,
        "_",
      ),
    );

  const cache = getCacheForModelProvider(getConfigKaiDemoMode(), logger, subDir(cacheDir ?? ""));
  const tracer = getCacheForModelProvider(getTraceEnabled(), logger, subDir(traceDir ?? ""), true);

  let capabilities: ModelCapabilities = {
    supportsTools: false,
    supportsToolsInStreaming: false,
  };
  try {
    let usingCachedHealthcheck = false;
    if (getConfigKaiDemoMode()) {
      const cachedHealthcheck = await cache.get("capabilities", {
        cacheSubDir: "healthcheck",
      });
      if (cachedHealthcheck) {
        capabilities = JSON.parse(cachedHealthcheck.content as string) as ModelCapabilities;
        usingCachedHealthcheck = true;
      }
    }
    if (!usingCachedHealthcheck) {
      capabilities = await runModelHealthCheck(streamingModel, nonStreamingModel);
      if (getConfigKaiDemoMode()) {
        await cache.set("capabilities", new AIMessage(JSON.stringify(capabilities)), {
          cacheSubDir: "healthcheck",
        });
      }
    }
  } catch (err) {
    logger.error("Error running model health check:", err);
    if (!getConfigKaiDemoMode()) {
      // only throw error when we are not in demo mode
      throw err;
    }
  }

  if (ModelProviders[parsedConfig.config.provider]) {
    return ModelProviders[parsedConfig.config.provider]();
  }

  return new BaseModelProvider(
    streamingModel,
    nonStreamingModel,
    capabilities,
    logger,
    cache,
    tracer,
  );
}
