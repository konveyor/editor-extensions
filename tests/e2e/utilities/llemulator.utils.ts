/**
 * Utilities for interacting with llemulator - a deterministic OpenAI API emulator
 * for testing and CI/CD pipelines.
 *
 * @see https://github.com/fabianvf/llemulator
 */

/**
 * Pattern-based rule for llemulator.
 * When times is -1, the rule is unlimited (never consumed).
 */
export interface LlemulatorPatternRule {
  pattern: string;
  response: string;
  /** Number of times this rule can be used (-1 = unlimited, default: 1) */
  times?: number;
}

export type LlemulatorResponse = string | LlemulatorPatternRule;

export interface LlemulatorScript {
  reset: boolean;
  responses: LlemulatorResponse[];
}

export interface KaiResponseParams {
  reasoning: string;
  language: string;
  fileContent: string;
  additionalInfo?: string;
}

/**
 * Builds a kai-formatted markdown response string.
 */
export function buildKaiResponse(params: KaiResponseParams): string {
  const { reasoning, language, fileContent, additionalInfo } = params;

  return `## Reasoning

${reasoning}

## Updated File

\`\`\`${language}
${fileContent}
\`\`\`

## Additional Information

${additionalInfo ?? 'No additional information.'}`;
}

export function isLlemulatorConfigured(): boolean {
  return !!process.env.TEST_LLEMULATOR_URL;
}

/**
 * Get the llemulator base URL from environment
 * @returns The base URL without /v1 suffix, or undefined if not configured
 */
export function getLlemulatorBaseUrl(): string | null {
  const url = process.env.TEST_LLEMULATOR_URL;
  if (!url) {
    return null;
  }

  return url.replace(/\/v1\/?$/, '');
}

/**
 * Default healthcheck rule that matches kai's model provider healthcheck.
 * The healthcheck sends "What is 2 gamma 2?" to verify the model works.
 * This rule is unlimited (times: -1) so it never gets consumed.
 *
 * See vscode/core/src/modelProvider/modelProvider.ts
 */
const HEALTHCHECK_RULE: LlemulatorPatternRule = {
  pattern: '.*gamma.*',
  response: 'Healthcheck response from llemulator',
  times: -1,
};

export async function loadLlemulatorResponses(
  script: LlemulatorScript,
  token: string = 'dummy-key-for-llemulator'
): Promise<void> {
  const baseUrl = getLlemulatorBaseUrl();

  if (!baseUrl) {
    throw new Error('Llemulator is not configured. Set TEST_LLEMULATOR_URL environment variable.');
  }

  const scriptWithHealthcheck: LlemulatorScript = {
    ...script,
    responses: [HEALTHCHECK_RULE, ...script.responses],
  };

  const response = await fetch(`${baseUrl}/_emulator/script`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(scriptWithHealthcheck),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to load llemulator responses: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  if (result.status !== 'loaded') {
    throw new Error(`Unexpected llemulator response: ${JSON.stringify(result)}`);
  }

  console.log('Llemulator responses loaded successfully');
}
