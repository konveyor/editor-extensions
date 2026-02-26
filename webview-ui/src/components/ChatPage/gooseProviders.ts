export interface GooseProviderOption {
  id: string;
  name: string;
  requiredEnvVars: string[];
  commonModels: string[];
}

export const GOOSE_PROVIDERS: GooseProviderOption[] = [
  {
    id: "openai",
    name: "OpenAI",
    requiredEnvVars: ["OPENAI_API_KEY"],
    commonModels: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    requiredEnvVars: ["ANTHROPIC_API_KEY"],
    commonModels: ["claude-sonnet-4-5-20250514", "claude-3-5-haiku-20241022"],
  },
  {
    id: "aws_bedrock",
    name: "AWS Bedrock",
    requiredEnvVars: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    commonModels: ["us.anthropic.claude-sonnet-4-5-20250929-v1:0"],
  },
  {
    id: "google",
    name: "Google Gemini",
    requiredEnvVars: ["GOOGLE_API_KEY"],
    commonModels: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-3-flash-preview"],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    requiredEnvVars: [],
    commonModels: ["llama3.3", "qwen2.5-coder"],
  },
  {
    id: "azure",
    name: "Azure OpenAI",
    requiredEnvVars: ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"],
    commonModels: [],
  },
  {
    id: "groq",
    name: "Groq",
    requiredEnvVars: ["GROQ_API_KEY"],
    commonModels: ["llama-3.3-70b-versatile"],
  },
];
