import { LLMProviders } from '../enums/llm-providers.enum';
import { isAWSConfigured } from '../../kai-evaluator/utils/s3.utils';

export interface ProviderConfig {
  model: string;
  provider: LLMProviders;
  config: string;
}

export const AWS_PROVIDER: ProviderConfig = {
  provider: LLMProviders.awsBedrock,
  model: 'meta.llama3-70b-instruct-v1:0',
  config: [
    '---',
    'active:',
    '  provider: "ChatBedrock"',
    '  args:',
    '    model_id: "meta.llama3-70b-instruct-v1:0"',
  ].join('\n'),
};

export const OPENAI_GPT4O_PROVIDER: ProviderConfig = {
  provider: LLMProviders.openAI,
  model: 'gpt-4o',
  config: ['---', 'active:', '  provider: "ChatOpenAI"', '  args:', '    model: "gpt-4o"'].join(
    '\n'
  ),
};

export const OPENAI_GPT4OMINI_PROVIDER: ProviderConfig = {
  provider: LLMProviders.openAI,
  model: 'gpt-4o-mini',
  config: [
    '---',
    'active:',
    '  provider: "ChatOpenAI"',
    '  args:',
    '    model: "gpt-4o-mini"',
  ].join('\n'),
};

export const GOOGLE_GEMINI_PROVIDER: ProviderConfig = {
  provider: LLMProviders.google,
  model: 'gemini-2.5-pro',
  config: [
    '---',
    'active:',
    '  provider: "ChatGoogleGenerativeAI"',
    '  args:',
    '    model: "gemini-2.5-pro"',
  ].join('\n'),
};

export const PARASOL_PROVIDER: ProviderConfig = {
  provider: LLMProviders.openAI,
  model: 'granite-3-3-8b-instruct',
  config: [
    '---',
    'active:',
    '  provider: "ChatOpenAI"',
    '  args:',
    '    model: "granite-3-3-8b-instruct"',
    '    configuration:',
    '      baseURL: "https://granite-3-3-8b-instruct-maas-apicast-production.apps.prod.rhoai.rh-aiservices-bu.com/v1"',
  ].join('\n'),
};

export const DEFAULT_PROVIDER = OPENAI_GPT4OMINI_PROVIDER;

export const providerConfigs: ProviderConfig[] = [
  //PARASOL_PROVIDER,
  AWS_PROVIDER,
  OPENAI_GPT4OMINI_PROVIDER,
];

export function getAvailableProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];
  if (process.env.OPENAI_API_KEY) {
    providers.push(OPENAI_GPT4OMINI_PROVIDER);
  }

  if (isAWSConfigured()) {
    providers.push(AWS_PROVIDER);
  }

  return [AWS_PROVIDER];
}
