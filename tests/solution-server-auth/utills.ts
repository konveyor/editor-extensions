export interface MCPConfig {
  url: string;
  realm: string;
  username: string;
  password: string;
  insecure: boolean;
}

const MCP_ENDPOINT_PATH = '/hub/services/kai/api';

/**
 * Builds the full MCP endpoint URL from a hub base URL.
 */
function buildMcpUrl(hubUrl: string): string {
  if (hubUrl.includes('/api') || hubUrl.endsWith('/api')) {
    return hubUrl;
  }
  const baseUrl = hubUrl.endsWith('/') ? hubUrl.slice(0, -1) : hubUrl;
  return `${baseUrl}${MCP_ENDPOINT_PATH}`;
}

export function validateSolutionServerConfig(url?: string): MCPConfig {
  // If URL is provided directly, use it; otherwise use TEST_HUB_URL
  let hubUrl = url || process.env.TEST_HUB_URL;

  if (!hubUrl) {
    throw new Error(
      'Missing required URL: provide url parameter or set TEST_HUB_URL environment variable'
    );
  }

  const finalUrl = buildMcpUrl(hubUrl);
  const authEnabled = process.env.TEST_HUB_AUTH_ENABLED === 'true';

  // Check for required auth variables if not local and auth is enabled
  if (authEnabled) {
    const requiredVars = ['TEST_HUB_USERNAME', 'TEST_HUB_PASSWORD'];

    for (const key of requiredVars) {
      if (!process.env[key] || process.env[key]?.trim() === '') {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    }
  }

  const insecure = process.env.TEST_HUB_INSECURE === 'true';
  if (insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  // Use TEST_HUB_REALM if available, otherwise default to 'tackle'
  const realm = process.env.TEST_HUB_REALM || process.env.SOLUTION_SERVER_REALM || 'tackle';

  return {
    url: finalUrl,
    realm,
    username: process.env.TEST_HUB_USERNAME || '',
    password: process.env.TEST_HUB_PASSWORD || '',
    insecure,
  };
}
