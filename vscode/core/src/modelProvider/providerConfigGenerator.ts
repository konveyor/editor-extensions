import { stringify } from "yaml";

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

/**
 * Generates provider-settings.yaml content from chat UI selections.
 * Maps UI provider IDs (e.g. "aws_bedrock") to LangChain provider names
 * (e.g. "ChatBedrock") and builds the YAML structure that parseModelConfig expects.
 */
export function generateProviderSettingsYaml(
  uiProviderId: string,
  model: string,
  credentials?: Record<string, string>,
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
    environment: {},
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
