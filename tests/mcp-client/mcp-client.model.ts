import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import { BestHintResponse, SuccessRateResponse } from './mcp-client-responses.model';

export class MCPClient {
  private readonly url: string;
  private transport: StreamableHTTPClientTransport;
  private client?: Client;

  constructor(url: string) {
    this.url = url;
    this.transport = new StreamableHTTPClientTransport(new URL(this.url));
  }

  public static async connect(url: string) {
    const mcpClient = new MCPClient(url);
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
      return mcpClient;
    } catch (error) {
      throw Error(`Failed to connect to the MCP server with error ${error}`);
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
