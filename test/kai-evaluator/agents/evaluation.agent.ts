import { createEvaluationChain } from '../chains/evaluation.chain';
import { FileEvaluationResult } from '../model/evaluation-result.model';
import { FileEvaluationInput } from '../model/evaluation-input.model';
import { isSyntaxValid } from '../utils/build.utils';

export async function evaluateFile(
  file: string,
  input: FileEvaluationInput
): Promise<FileEvaluationResult> {
  const chain = await createEvaluationChain();

  const incidentDescriptions = input.incidents
    .map(
      (i, idx) =>
        `Incident ${idx + 1}: ${i.message}\nCode Snippet:\n\`\`\`\n${i.codeSnip}\n\`\`\`\nLine Number: ${i.lineNumber}`
    )
    .join('\n\n');

  const query = `Original content: \n\`\`\`\n${input.originalContent}\n\`\`\`\n Incidents: ${incidentDescriptions}\n UpdatedContent: \n\`\`\`\n${input.updatedContent}\n\`\`\``;

  // TODO support multiple targets and fetch them from a different place
  const evalResult = await chain.invoke({
    query,
    source: 'java-ee',
    target: 'quarkus',
  });

  return {
    file,
    ...evalResult,
    averageScore: (evalResult.effectiveness + evalResult.specificity + evalResult.competency) / 3,
    validCode: file.toLowerCase().endsWith('java')
      ? await isSyntaxValid(input.updatedContent)
      : true,
  };
}
