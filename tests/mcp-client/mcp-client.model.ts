import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import { BestHintResponse, SuccessRateResponse } from './mcp-client-responses.model';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export class MCPClient {
  private readonly url: string;
  private transport: StreamableHTTPClientTransport;
  private client?: Client;
  private token?: string;

  constructor(url: string, bearerToken?: string) {
    this.url = url;
    this.token = bearerToken;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: {
        headers,
      },
    });
  }

  private async refreshToken(): Promise<void> {
    try {
      const newToken = await MCPClient.exchangeForTokens();
      this.token = newToken;

      this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
        requestInit: {
          headers: { Authorization: `Bearer ${newToken}` },
        },
      });
      await this.client?.connect(this.transport);

      console.log('✅ Token refreshed successfully');
    } catch (err) {
      console.error('Failed to refresh token:', err);
    }
  }

  private static async exchangeForTokens(): Promise<string> {
    const serverUrl = process.env.SOLUTION_SERVER_URL!;
    const realm = process.env.SOLUTION_SERVER_REALM!;
    const username = process.env.SOLUTION_SERVER_USERNAME!;
    const password = process.env.SOLUTION_SERVER_PASSWORD!;

    const url = new URL(serverUrl);
    const keycloakUrl = `${url.protocol}//${url.host}/auth`;
    const tokenUrl = `${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`;

    const params = new URLSearchParams();
    params.append('grant_type', 'password');
    params.append('client_id', `${realm}-ui`);
    params.append('username', username);
    params.append('password', password);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Auth failed ${response.status}: ${text.slice(0, 200)}`);
    }

    const { access_token } = await response.json();
    return access_token;
  }

  public static async connect(url: string, bearerToken?: string) {
    let token: string | undefined;
    if (!url.includes('localhost')) {
      token = await MCPClient.exchangeForTokens();
    }
    const mcpClient = new MCPClient(url, token);
    mcpClient.client = new Client(
      {
        name: 'testing-mcp-client',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    try {
      await mcpClient.client.connect(mcpClient.transport);
      console.log('Connected successfully to Solution Server');
      setInterval(() => {
        mcpClient.refreshToken().catch((e) => console.error('Token refresh failed:', e));
      }, 50_000);
      return mcpClient;
    } catch (error) {
      throw new Error(`Failed to connect to the MCP server: ${(error as Error).message}`);
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
