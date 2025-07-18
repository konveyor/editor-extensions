import { LLMProviders } from '../enums/llm-providers.enum';

export interface ProviderConfig {
  model: string;
  provider: LLMProviders;
  config: string;
}

export const AWS_PROVIDER: ProviderConfig = {
  provider: LLMProviders.awsBedrock,
  model: 'meta.llama3-70b-instruct-v1:0',
  config: [
    'models:',
    '  AmazonBedrock: &active',
    '    environment:',
    `      AWS_ACCESS_KEY_ID: "${process.env.AWS_ACCESS_KEY_ID}"`,
    `      AWS_SECRET_ACCESS_KEY: "${process.env.AWS_SECRET_ACCESS_KEY}"`,
    `      AWS_DEFAULT_REGION: "${process.env.AWS_DEFAULT_REGION}"`,
    '    provider: "ChatBedrock"',
    '    args:',
    '      model_id: "meta.llama3-70b-instruct-v1:0"',
    'active: *active',
  ].join('\n'),
};

export const OPENAI_PROVIDER: ProviderConfig = {
  provider: LLMProviders.openAI,
  model: 'gpt-4o-mini',
  config: [
    'models:',
    '  OpenAI: &active',
    '    environment:',
    `      OPENAI_API_KEY: "${process.env.OPENAI_API_KEY}"`,
    '    provider: "ChatOpenAI"',
    '    args:',
    '      model: "gpt-4o-mini"',
    'active: *active',
  ].join('\n'),
};

export const PARASOL_PROVIDER: ProviderConfig = {
  provider: LLMProviders.openAI,
  model: 'granite-3-3-8b-instruct',
  config: [
    'models:',
    '  parasols-maas-granite: &active',
    '    environment:',
    `      OPENAI_API_KEY: "${process.env.PARASOL_API_KEY}"`,
    '    provider: "ChatOpenAI"',
    '    args:',
    '      model: "granite-3-3-8b-instruct"',
    '      configuration:',
    '        baseURL: "https://granite-3-3-8b-instruct-maas-apicast-production.apps.prod.rhoai.rh-aiservices-bu.com/v1"',
    'active: *active',
  ].join('\n'),
};

export const DEFAULT_PROVIDER = OPENAI_PROVIDER;

export const providerConfigs: ProviderConfig[] = [
  //PARASOL_PROVIDER,
  AWS_PROVIDER,
  OPENAI_PROVIDER,
];
