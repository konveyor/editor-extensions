import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import { BestHintResponse, SuccessRateResponse } from './mcp-client-responses.model';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

const TOKEN_EXPIRY_BUFFER_MS = 30000;

export class MCPClient {
  private readonly url: string;
  private transport?: StreamableHTTPClientTransport;
  private client?: Client;
  private bearerToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(url: string) {
    this.url = url;

    // Allow self-signed certificates for local/dev environments
    if (process.env.SOLUTION_SERVER_INSECURE === 'true') {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
  }

  public static async connect(url?: string) {
    const fullUrl = url || process.env.SOLUTION_SERVER_URL!;
    const mcpClient = new MCPClient(fullUrl);
    await mcpClient.initialize();
    return mcpClient;
  }

  private async initialize(): Promise<void> {
    const isLocal = process.env.SOLUTION_SERVER_LOCAL === 'true';

    if (isLocal) {
      this.bearerToken = process.env.LOCAL_MCP_TOKEN || 'local-mcp-token';
    } else {
      await this.authenticateFromEnv();
    }

    const headers: Record<string, string> = {};
    if (this.bearerToken) headers['Authorization'] = `Bearer ${this.bearerToken}`;

    this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers },
    });

    this.client = new Client(
      { name: 'authenticated-mcp-client', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} } }
    );

    await this.client.connect(this.transport);

    if (!isLocal) this.startTokenRefreshTimer();
  }

  private async authenticateFromEnv(): Promise<void> {
    const username = process.env.SOLUTION_SERVER_USERNAME;
    const password = process.env.SOLUTION_SERVER_PASSWORD;
    const realm = process.env.SOLUTION_SERVER_REALM;
    const url = new URL(this.url);
    const tokenUrl = `${url.protocol}//${url.host}/auth/realms/${realm}/protocol/openid-connect/token`;

    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', `${realm}-ui`);
    params.append('username', username || '');
    params.append('password', password || '');

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params,
    });

    if (!response.ok) {
      const msg = await response.text();
      throw new Error(`Authentication failed: ${response.status} ${msg}`);
    }

    const tokenData = (await response.json()) as TokenResponse;
    this.bearerToken = tokenData.access_token;
    this.refreshToken = tokenData.refresh_token || null;
    this.tokenExpiresAt = Date.now() + tokenData.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;
  }

  private startTokenRefreshTimer(): void {
    if (!this.tokenExpiresAt || !this.refreshToken) return;
    const timeUntilRefresh = this.tokenExpiresAt - Date.now();
    this.refreshTimer = setTimeout(() => this.refreshTokenFlow(), Math.max(0, timeUntilRefresh));
  }

  private async refreshTokenFlow(): Promise<void> {
    const realm = process.env.SOLUTION_SERVER_REALM;
    const url = new URL(this.url);
    const tokenUrl = `${url.protocol}//${url.host}/auth/realms/${realm}/protocol/openid-connect/token`;

    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', `${realm}-ui`);
    params.append('refresh_token', this.refreshToken!);

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params,
      });

      if (!response.ok) throw new Error(`Token refresh failed (${response.status})`);

      const tokenData = (await response.json()) as TokenResponse;
      this.bearerToken = tokenData.access_token;
      this.refreshToken = tokenData.refresh_token || this.refreshToken;
      this.tokenExpiresAt = Date.now() + tokenData.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;

      if (this.client && this.transport) {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${this.bearerToken}`,
        };
        this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
          requestInit: { headers },
        });
        await this.client.connect(this.transport);
      }

      this.startTokenRefreshTimer();
    } catch (error) {
      console.error('Token refresh error:', error);
    }
  }

  public async getBestHint(rulesetName: string, violationName: string): Promise<BestHintResponse> {
    const bestHintSchema = z.object({
      hint_id: z.number(),
      hint: z.string(),
    });

    const response = await this.request<BestHintResponse>(
      'get_best_hint',
      {
        ruleset_name: rulesetName,
        violation_name: violationName,
      },
      bestHintSchema
    );

    return (
      response || {
        hint_id: -1,
        hint: '',
      }
    );
  }

  public async getSuccessRate(
    violationIds: {
      violation_name: string;
      ruleset_name: string;
    }[]
  ): Promise<SuccessRateResponse> {
    const successRateSchema = z.object({
      counted_solutions: z.number(),
      accepted_solutions: z.number(),
      rejected_solutions: z.number(),
      modified_solutions: z.number(),
      pending_solutions: z.number(),
      unknown_solutions: z.number(),
    });

    const response = await this.request<SuccessRateResponse>(
      'get_success_rate',
      { violation_ids: violationIds },
      successRateSchema
    );

    return (
      response || {
        counted_solutions: 0,
        accepted_solutions: 0,
        rejected_solutions: 0,
        modified_solutions: 0,
        pending_solutions: 0,
        unknown_solutions: 0,
      }
    );
  }

  private async request<T>(
    endpoint: string,
    params: any,
    schema: z.ZodSchema<T>
  ): Promise<T | null> {
    const result = await this.client?.callTool({
      name: endpoint,
      arguments: params,
    });

    console.log(result);

    if (result?.isError) {
      const errorMessage = Array.isArray(result.content)
        ? result.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text)
            .join(' ')
        : 'Unknown error';
      throw new Error(
        `An error occurred during the request: ${errorMessage}\n endpoint: ${endpoint}\n params: ${JSON.stringify(params)}`
      );
    }

    if (!result?.content || !Array.isArray(result.content)) {
      throw new Error(`No content received from ${endpoint}`);
    }

    const textContent = result.content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text)
      .join('');

    if (!textContent) {
      return null;
    }

    try {
      const jsonData = JSON.parse(textContent);
      return schema.parse(jsonData);
    } catch (parseError) {
      throw new Error(`Failed to parse JSON response: ${parseError}`);
    }
  }
}
