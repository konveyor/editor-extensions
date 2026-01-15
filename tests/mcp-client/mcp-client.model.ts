import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import { BestHintResponse, SuccessRateResponse } from './mcp-client-responses.model';
import { AuthenticationManager } from '../solution-server-auth/authentication-manager';
import { validateSolutionServerConfig } from '../solution-server-auth/utills';

export class MCPClient {
  private readonly url: string;
  private transport?: StreamableHTTPClientTransport;
  private client?: Client;
  private authManager: AuthenticationManager;
  private currentToken: string | null = null;

  constructor(url: string, authManager: AuthenticationManager) {
    this.url = url;
    this.authManager = authManager;
  }

  public static async connect(url?: string): Promise<MCPClient> {
    const config = validateSolutionServerConfig(url);
    const fullUrl = url || config.url;

    const authManager = new AuthenticationManager(
      fullUrl,
      config.realm,
      config.username,
      config.password,
      config.isLocal
    );
    const mcpClient = new MCPClient(fullUrl, authManager);
    await mcpClient.connectTransport();
    return mcpClient;
  }

  private async connectTransport(): Promise<void> {
    const token = await this.authManager.getBearerToken();
    this.currentToken = token;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };

    this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers },
    });

    this.client = new Client(
      { name: 'authenticated-mcp-client', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} } }
    );

    await this.client.connect(this.transport);
  }

  private async reconnectWithNewToken(token: string): Promise<void> {
    if (!this.client || !this.transport) {
      throw new Error('Cannot reconnect: client or transport not initialized');
    }
    await this.transport.close();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    this.transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers },
    });
    await this.client.connect(this.transport);
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
    const responseSchema = z.array(successRateSchema);

    const response = await this.request<SuccessRateResponse[]>(
      'get_success_rate',
      { violation_ids: violationIds },
      responseSchema
    );

    if (response && response.length > 0) {
      return response[0];
    }

    return {
      counted_solutions: 0,
      accepted_solutions: 0,
      rejected_solutions: 0,
      modified_solutions: 0,
      pending_solutions: 0,
      unknown_solutions: 0,
    };
  }
  private isUnauthorized(result: any): boolean {
    const msg = JSON.stringify(result?.content || '');
    return msg.includes('401') || msg.includes('403') || msg.includes('unauthorized');
  }

  private async request<T>(
    endpoint: string,
    params: any,
    schema: z.ZodSchema<T>,
    retries = 1
  ): Promise<T | null> {
    if (!this.client) {
      throw new Error('MCP client is not connected');
    }
    const token = await this.authManager.getBearerToken();
    if (token !== this.currentToken) {
      await this.reconnectWithNewToken(token);
      this.currentToken = token;
    }

    const result = await this.client?.callTool({
      name: endpoint,
      arguments: params,
    });

    console.log(result);

    if (result?.isError) {
      if (this.isUnauthorized(result) && retries > 0) {
        console.warn('Received auth error — attempting token refresh...');
        const newToken = await this.authManager.getBearerToken(true);
        await this.reconnectWithNewToken(newToken);
        this.currentToken = newToken;
        return await this.request(endpoint, params, schema, retries - 1);
      }

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

  public async dispose(): Promise<void> {
    this.authManager.dispose();

    if (this.transport) {
      this.transport.close().catch((err) => console.error('Error closing transport:', err));
    }

    this.client = undefined;
    this.transport = undefined;
    this.currentToken = null;
  }
}
