export interface MCPConfig {
  url: string;
  realm: string;
  username: string;
  password: string;
  isLocal: boolean;
  insecure: boolean;
}

export function validateSolutionServerConfig(url?: string): MCPConfig {
  const finalUrl = url || process.env.SOLUTION_SERVER_URL;
  if (!finalUrl) {
    throw new Error('Missing required URL');
  }
  const isLocal = finalUrl.startsWith('http://');

  if (!isLocal) {
    const requiredVars = [
      'SOLUTION_SERVER_REALM',
      'SOLUTION_SERVER_USERNAME',
      'SOLUTION_SERVER_PASSWORD',
    ];

    for (const key of requiredVars) {
      if (!process.env[key] || process.env[key]?.trim() === '') {
        throw new Error(`Missing required environment variable: ${key}`);
      }
    }
  }

  const insecure = process.env.SOLUTION_SERVER_INSECURE === 'true';
  if (insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  return {
    url: finalUrl,
    realm: process.env.SOLUTION_SERVER_REALM || '',
    username: process.env.SOLUTION_SERVER_USERNAME || '',
    password: process.env.SOLUTION_SERVER_PASSWORD || '',
    isLocal,
    insecure,
  };
}
