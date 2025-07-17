import { parse } from "yaml";
import { workspace, Uri } from "vscode";
import { KaiModelProvider } from "@editor-extensions/agentic";

import { ParsedModelConfig } from "./types";
import { ModelCreators } from "./modelCreator";
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

export async function getModelProviderFromConfig(
  parsedConfig: ParsedModelConfig,
): Promise<KaiModelProvider> {
  if (!ModelCreators[parsedConfig.config.provider]) {
    throw new Error("Unsupported model provider");
  }

  const modelCreator = ModelCreators[parsedConfig.config.provider]();
  const defaultArgs = modelCreator.defaultArgs();
  const configArgs = parsedConfig.config.args;
  //NOTE (pgaikwad) - this overwrites nested properties of defaultargs with configargs
  const args = { ...defaultArgs, ...configArgs };
  modelCreator.validate(args, parsedConfig.env);
  const streamingModel = modelCreator.create(
    {
      ...args,
      streaming: true,
    },
    parsedConfig.env,
  );
  const nonStreamingModel = modelCreator.create(
    {
      ...args,
      streaming: false,
    },
    parsedConfig.env,
  );

  if (ModelProviders[parsedConfig.config.provider]) {
    return ModelProviders[parsedConfig.config.provider]();
  }

  const capabilities = await runModelHealthCheck(streamingModel, nonStreamingModel);

  return new BaseModelProvider(streamingModel, nonStreamingModel, capabilities);
}
