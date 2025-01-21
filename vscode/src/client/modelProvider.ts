import { workspace, Uri } from "vscode";
import { parse } from "yaml";
import { KaiConfigModels } from "./types";

export interface ModelProvider {
  env: Record<string, string>;
  modelProvider: KaiConfigModels;
}

export async function getModelProvider(yamlUri: Uri): Promise<ModelProvider> {
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
    modelProvider: {
      provider,
      args,
      template,
      llamaHeader,
      llmRetries,
      llmRetryDelay,
    },
  };
}
