import { LANGCHAIN_PROMPT_TEMPLATE } from '../prompts/evaluation.prompt';
import { StructuredOutputParser } from 'langchain/output_parsers';
import { z } from 'zod';
import { BedrockChat } from '@langchain/community/chat_models/bedrock';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { isAWSConfigured } from '../utils/s3.utils';

const outputSchema = z.object({
  specificity: z.number().min(0).max(10),
  competency: z.number().min(0).max(10),
  effectiveness: z.number().min(0).max(10),
  unnecessaryChanges: z.boolean(),
  detailedNotes: z.string(),
});

const outputParser = StructuredOutputParser.fromZodSchema(outputSchema);

export async function createEvaluationChain() {
  if (!isAWSConfigured()) {
    throw new Error(
      'Required AWS environment variables are not set: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION'
    );
  }
  const model = new BedrockChat({
    model: 'meta.llama3-70b-instruct-v1:0',
    region: process.env.AWS_REGION,
    maxTokens: 500,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', LANGCHAIN_PROMPT_TEMPLATE],
    ['user', '{query}'],
  ]);

  // Output parser instead of withStructuredOutput as tool calling through Bedrock is only supported for Anthropic models
  return prompt.pipe(model).pipe(outputParser);
}
