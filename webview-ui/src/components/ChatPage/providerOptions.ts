export interface ProviderEnvVar {
  key: string;
  label: string;
  isSecret?: boolean;
  /** Must be supplied (or already stored) before the provider can start. */
  required?: boolean;
}

export interface ProviderOption {
  id: string;
  name: string;
  envVars: ProviderEnvVar[];
  commonModels: string[];
}

export const PROVIDERS: ProviderOption[] = [
  {
    id: "openai",
    name: "OpenAI",
    envVars: [{ key: "OPENAI_API_KEY", label: "API Key", isSecret: true }],
    commonModels: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    envVars: [{ key: "ANTHROPIC_API_KEY", label: "API Key", isSecret: true }],
    commonModels: ["claude-sonnet-4-5-20250929", "claude-3-5-haiku-20241022"],
  },
  {
    id: "aws_bedrock",
    name: "AWS Bedrock",
    envVars: [
      { key: "AWS_ACCESS_KEY_ID", label: "Access Key ID", isSecret: true },
      { key: "AWS_SECRET_ACCESS_KEY", label: "Secret Access Key", isSecret: true },
      { key: "AWS_REGION", label: "Region" },
    ],
    commonModels: ["us.anthropic.claude-sonnet-4-5-20250929-v1:0"],
  },
  {
    id: "google",
    name: "Google Gemini",
    envVars: [{ key: "GOOGLE_API_KEY", label: "API Key", isSecret: true }],
    commonModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-flash-preview"],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    envVars: [],
    commonModels: ["llama3.3", "qwen2.5-coder"],
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    // Keys mirror the env vars Goose/OpenCode's Azure providers read; the
    // extension maps them into LangChain args for the direct client.
    envVars: [
      { key: "AZURE_OPENAI_API_KEY", label: "API Key", isSecret: true, required: true },
      { key: "AZURE_OPENAI_ENDPOINT", label: "Endpoint", required: true },
      { key: "AZURE_OPENAI_DEPLOYMENT_NAME", label: "Deployment name", required: true },
      { key: "AZURE_OPENAI_API_VERSION", label: "API version", required: true },
    ],
    commonModels: [],
  },
  {
    id: "groq",
    name: "Groq",
    envVars: [{ key: "GROQ_API_KEY", label: "API Key", isSecret: true }],
    commonModels: ["llama-3.3-70b-versatile"],
  },
];
