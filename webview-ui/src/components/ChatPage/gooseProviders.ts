export interface GooseEnvVar {
  key: string;
  label: string;
  isSecret?: boolean;
}

export interface GooseProviderOption {
  id: string;
  name: string;
  envVars: GooseEnvVar[];
  commonModels: string[];
}

export const GOOSE_PROVIDERS: GooseProviderOption[] = [
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
    commonModels: ["claude-sonnet-4-5-20250514", "claude-3-5-haiku-20241022"],
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
    envVars: [
      { key: "AZURE_OPENAI_API_KEY", label: "API Key", isSecret: true },
      { key: "AZURE_OPENAI_ENDPOINT", label: "Endpoint" },
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
