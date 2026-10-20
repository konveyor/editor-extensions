import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";
import type { AgentConfig, AgentCapability } from "@editor-extensions/shared";
import { getConfigAgentBackend } from "./utilities/configuration";
import { readGooseConfig, writeGooseConfig, getGooseConfigPath } from "./gooseConfig";
import type { WriteGooseConfigChanges } from "./gooseConfig";
import { langchainProviderToUiId } from "./modelProvider/providerConfigGenerator";

// ─── Backend-agnostic config API ────────────────────────────────────

export interface WriteAgentConfigChanges {
  provider?: string;
  model?: string;
  extensions?: Array<{ id: string; enabled: boolean }>;
}

/**
 * Read the active agent backend's configuration and return a
 * backend-agnostic AgentConfig for the UI.
 */
export function readAgentConfig(): AgentConfig {
  const backend = getConfigAgentBackend();
  switch (backend) {
    case "opencode":
      return readOpencodeConfig();
    default:
      return readGooseConfig();
  }
}

/**
 * Write configuration changes to the active agent backend's config file.
 */
export function writeAgentConfig(changes: WriteAgentConfigChanges): void {
  const backend = getConfigAgentBackend();
  switch (backend) {
    case "opencode":
      writeOpencodeConfig(changes);
      break;
    default:
      writeGooseConfig(changes as WriteGooseConfigChanges);
      break;
  }
}

/**
 * Return the path to the active agent backend's native config file.
 */
export function getAgentConfigPath(backend: string, workspaceRoot?: string): string {
  switch (backend) {
    case "opencode":
      return path.join(workspaceRoot ?? ".", "opencode.json");
    default:
      return getGooseConfigPath();
  }
}

// ─── OpenCode config ────────────────────────────────────────────────

function readOpencodeConfig(): AgentConfig {
  const capabilities: AgentCapability[] = [];

  let provider = "";
  let model = "";
  try {
    const { fsPaths } = require("./paths");
    const content = fs.readFileSync(fsPaths().settingsYaml, "utf-8");
    const doc = parse(content) as Record<string, any> | undefined;
    const active = doc?.active;
    if (active) {
      const langchainName = typeof active.provider === "string" ? active.provider : "";
      provider = langchainProviderToUiId(langchainName, active.args) ?? langchainName;
      model = typeof active.args?.model === "string" ? active.args.model : "";
    }
  } catch {
    // provider-settings.yaml missing or malformed — use defaults
  }

  return {
    backend: "opencode",
    agentMode: false,
    provider,
    model,
    capabilities,
    hasStoredCredentials: false,
  };
}

function writeOpencodeConfig(_changes: WriteAgentConfigChanges): void {
  // OpenCode has no user-editable config we own: provider and model persist in
  // provider-settings.yaml (see readOpencodeConfig) and are handed to the
  // `opencode acp` process at launch via OPENCODE_CONFIG_CONTENT — see
  // getAgentLaunchEnv(). Nothing to write here.
}

// ─── Launch environment ─────────────────────────────────────────────

/** UI provider id → OpenCode provider id (models are addressed as `<provider>/<model>`). */
const OPENCODE_PROVIDER_IDS: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  aws_bedrock: "amazon-bedrock",
  azure: "azure",
  groq: "groq",
  ollama: "ollama",
};

const OLLAMA_DEFAULT_BASE_URL = "http://localhost:11434/v1";

/**
 * Build the inline OpenCode config that selects the provider and model the
 * user picked in the chat settings. OpenCode reads it from the
 * OPENCODE_CONFIG_CONTENT environment variable and layers it over its own
 * global/project config, so only the keys we set here are overridden.
 *
 * Returns undefined when there is nothing to select (no provider/model yet).
 */
export function buildOpencodeConfigContent(provider: string, model: string): string | undefined {
  if (!provider || !model) {
    return undefined;
  }
  const opencodeProvider = OPENCODE_PROVIDER_IDS[provider] ?? provider;

  // Declaring the model under the provider lets OpenCode accept model ids
  // that are not (yet) in its models.dev catalog; for known ids it merges
  // with the catalog entry.
  const providerConfig: Record<string, unknown> = {
    models: { [model]: { name: model } },
  };
  if (opencodeProvider === "ollama") {
    // Ollama is not a built-in OpenCode provider: it is an OpenAI-compatible
    // endpoint that has to be declared explicitly.
    providerConfig.npm = "@ai-sdk/openai-compatible";
    providerConfig.name = "Ollama (local)";
    providerConfig.options = { baseURL: OLLAMA_DEFAULT_BASE_URL };
  }

  return JSON.stringify({
    model: `${opencodeProvider}/${model}`,
    provider: { [opencodeProvider]: providerConfig },
  });
}

/**
 * Environment variables that make the given backend use the selected
 * provider/model. Goose reads its own config.yaml (written by
 * writeGooseConfig) so needs nothing; OpenCode is configured inline.
 */
export function getAgentLaunchEnv(
  backend: string,
  config: { provider: string; model: string },
): Record<string, string> {
  switch (backend) {
    case "opencode": {
      const content = buildOpencodeConfigContent(config.provider, config.model);
      return content ? { OPENCODE_CONFIG_CONTENT: content } : {};
    }
    default:
      return {};
  }
}
