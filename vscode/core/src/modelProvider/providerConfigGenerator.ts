import { parse, stringify } from "yaml";
import { workspace, type Uri } from "vscode";

interface ProviderMapping {
  langchainProvider: string;
  /** UI credential key → environment key written to provider-settings.yaml */
  envVarMap: Record<string, string>;
  /**
   * UI credential key → LangChain constructor arg. Some providers need
   * non-env settings (Azure's deployment name / API version) that the
   * DirectLLMClient only reads from `active.args`.
   */
  argsFromEnv?: Record<string, string>;
  /** UI credential keys that must be present for the provider to initialise. */
  requiredEnvVars?: string[];
  extraArgs?: Record<string, unknown>;
}

const PROVIDER_MAP: Record<string, ProviderMapping> = {
  openai: {
    langchainProvider: "ChatOpenAI",
    envVarMap: { OPENAI_API_KEY: "OPENAI_API_KEY" },
  },
  aws_bedrock: {
    langchainProvider: "ChatBedrock",
    envVarMap: {
      AWS_ACCESS_KEY_ID: "AWS_ACCESS_KEY_ID",
      AWS_SECRET_ACCESS_KEY: "AWS_SECRET_ACCESS_KEY",
      AWS_REGION: "AWS_DEFAULT_REGION",
    },
  },
  google: {
    langchainProvider: "ChatGoogleGenerativeAI",
    envVarMap: { GOOGLE_API_KEY: "GOOGLE_API_KEY" },
  },
  ollama: {
    langchainProvider: "ChatOllama",
    envVarMap: {},
  },
  azure: {
    langchainProvider: "AzureChatOpenAI",
    // Env keys match what Goose/OpenCode's Azure providers read from the
    // spawn environment; the direct LangChain client needs them as args.
    envVarMap: {
      AZURE_OPENAI_API_KEY: "AZURE_OPENAI_API_KEY",
      AZURE_OPENAI_ENDPOINT: "AZURE_OPENAI_ENDPOINT",
      AZURE_OPENAI_DEPLOYMENT_NAME: "AZURE_OPENAI_DEPLOYMENT_NAME",
      AZURE_OPENAI_API_VERSION: "AZURE_OPENAI_API_VERSION",
    },
    argsFromEnv: {
      AZURE_OPENAI_ENDPOINT: "azureOpenAIEndpoint",
      AZURE_OPENAI_DEPLOYMENT_NAME: "azureOpenAIApiDeploymentName",
      AZURE_OPENAI_API_VERSION: "azureOpenAIApiVersion",
    },
    requiredEnvVars: [
      "AZURE_OPENAI_API_KEY",
      "AZURE_OPENAI_ENDPOINT",
      "AZURE_OPENAI_DEPLOYMENT_NAME",
      "AZURE_OPENAI_API_VERSION",
    ],
  },
  groq: {
    langchainProvider: "ChatOpenAI",
    envVarMap: { GROQ_API_KEY: "OPENAI_API_KEY" },
    extraArgs: {
      configuration: { baseURL: "https://api.groq.com/openai/v1" },
    },
  },
  anthropic: {
    langchainProvider: "ChatAnthropic",
    envVarMap: { ANTHROPIC_API_KEY: "ANTHROPIC_API_KEY" },
  },
};

function isSubset(expected: unknown, actual: unknown): boolean {
  if (expected === actual) {
    return true;
  }
  if (
    expected &&
    actual &&
    typeof expected === "object" &&
    typeof actual === "object" &&
    !Array.isArray(expected) &&
    !Array.isArray(actual)
  ) {
    return Object.entries(expected as Record<string, unknown>).every(([k, v]) =>
      isSubset(v, (actual as Record<string, unknown>)[k]),
    );
  }
  return false;
}

export function langchainProviderToUiId(
  langchainProvider: string,
  args?: Record<string, unknown>,
): string | undefined {
  const matches = Object.entries(PROVIDER_MAP).filter(
    ([, m]) => m.langchainProvider === langchainProvider,
  );
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length === 1) {
    return matches[0][0];
  }
  // Disambiguate duplicate LangChain names (e.g. ChatOpenAI → openai vs groq)
  for (const [uiId, m] of matches) {
    if (m.extraArgs && args && isSubset(m.extraArgs, args)) {
      return uiId;
    }
  }
  // Fall back to the entry without extraArgs (the "plain" one)
  return matches.find(([, m]) => !m.extraArgs)?.[0] ?? matches[0][0];
}

/** What an existing provider-settings.yaml contributes to a regenerated one. */
export interface ExistingProviderSettings {
  /**
   * Credentials recovered from `active.environment` / `active.args`, keyed by
   * UI credential key (the inverse of `envVarMap` / `argsFromEnv`).
   */
  credentials: Record<string, string>;
  /**
   * The top-level `environment:` block (proxy settings such as HTTPS_PROXY,
   * CA_BUNDLE, ALLOW_INSECURE) plus any `active.environment` keys that are not
   * credentials of the active provider. Regeneration keeps these verbatim.
   */
  environment: Record<string, string>;
}

const EMPTY_PROVIDER_SETTINGS: ExistingProviderSettings = { credentials: {}, environment: {} };

function stringEntries(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string" && v) {
        out[k] = v;
      }
    }
  }
  return out;
}

/**
 * Recover the credentials and environment stored in a provider-settings.yaml,
 * so that regenerating the file from the chat UI does not drop values the
 * user configured by editing the file directly (the documented way to set up
 * a provider before the chat settings existed, and still the only way to set
 * proxy options).
 *
 * Malformed or empty input yields empty maps rather than throwing.
 */
export function extractProviderSettings(yamlContent: string): ExistingProviderSettings {
  let doc: unknown;
  try {
    doc = parse(yamlContent);
  } catch {
    return EMPTY_PROVIDER_SETTINGS;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return EMPTY_PROVIDER_SETTINGS;
  }
  const { environment: baseEnv, active } = doc as Record<string, unknown>;
  const environment = stringEntries(baseEnv);
  const credentials: Record<string, string> = {};

  if (active && typeof active === "object" && !Array.isArray(active)) {
    const { provider, args, environment: activeEnv } = active as Record<string, unknown>;
    const argMap = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const uiId =
      typeof provider === "string" ? langchainProviderToUiId(provider, argMap) : undefined;
    const mapping = uiId ? PROVIDER_MAP[uiId] : undefined;

    // yaml env key → UI credential key for the active provider. Unknown
    // providers fall back to identity so hand-written keys still survive.
    const envToUi: Record<string, string> = {};
    for (const [uiKey, yamlKey] of Object.entries(mapping?.envVarMap ?? {})) {
      envToUi[yamlKey] = uiKey;
    }
    for (const [yamlKey, value] of Object.entries(stringEntries(activeEnv))) {
      const uiKey = envToUi[yamlKey] ?? (mapping ? undefined : yamlKey);
      if (uiKey) {
        credentials[uiKey] = value;
      } else {
        environment[yamlKey] = value;
      }
    }
    for (const [uiKey, argKey] of Object.entries(mapping?.argsFromEnv ?? {})) {
      const value = argMap[argKey];
      if (typeof value === "string" && value) {
        credentials[uiKey] = value;
      }
    }
  }

  return { credentials, environment };
}

/**
 * `extractProviderSettings` for the file at `uri`; a missing or unreadable
 * file contributes nothing.
 */
export async function readExistingProviderSettings(uri: Uri): Promise<ExistingProviderSettings> {
  try {
    const raw = await workspace.fs.readFile(uri);
    return extractProviderSettings(new TextDecoder("utf8").decode(raw));
  } catch {
    return EMPTY_PROVIDER_SETTINGS;
  }
}

export interface GenerateProviderSettingsOptions {
  /** Top-level `environment:` block to keep (see `ExistingProviderSettings.environment`). */
  baseEnvironment?: Record<string, string>;
}

/**
 * Generates provider-settings.yaml content from chat UI selections.
 * Maps UI provider IDs (e.g. "aws_bedrock") to LangChain provider names
 * (e.g. "ChatBedrock") and builds the YAML structure that parseModelConfig expects.
 */
export function generateProviderSettingsYaml(
  uiProviderId: string,
  model: string,
  credentials?: Record<string, string>,
  options: GenerateProviderSettingsOptions = {},
): string {
  const mapping = PROVIDER_MAP[uiProviderId];
  if (!mapping) {
    throw new Error(`Unknown provider: ${uiProviderId}`);
  }

  const environment: Record<string, string> = {};
  const providerArgs: Record<string, unknown> = {};
  if (credentials) {
    for (const [uiKey, yamlKey] of Object.entries(mapping.envVarMap)) {
      if (credentials[uiKey]) {
        environment[yamlKey] = credentials[uiKey];
      }
    }
    for (const [uiKey, argKey] of Object.entries(mapping.argsFromEnv ?? {})) {
      if (credentials[uiKey]) {
        providerArgs[argKey] = credentials[uiKey];
      }
    }
  }

  const missing = (mapping.requiredEnvVars ?? []).filter((key) => !credentials?.[key]);
  if (missing.length > 0) {
    throw new Error(`${uiProviderId} requires: ${missing.join(", ")}`);
  }

  const args: Record<string, unknown> = { model, ...providerArgs, ...mapping.extraArgs };

  const doc: Record<string, unknown> = {
    environment: { ...(options.baseEnvironment ?? {}) },
    active: {
      ...(Object.keys(environment).length > 0 ? { environment } : {}),
      provider: mapping.langchainProvider,
      args,
    },
  };

  return (
    "# Generated by Konveyor chat UI — edit via the settings gear in the chat panel\n---\n" +
    stringify(doc)
  );
}
