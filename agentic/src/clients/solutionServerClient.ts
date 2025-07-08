import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EnhancedIncident, SuccessRateMetric } from "@editor-extensions/shared";

export interface SolutionFile {
  uri: string;
  content: string;
}

export interface GetBestHintResult {
  hint: string;
  hint_id: number;
}

export interface CreateMultipleIncidentsResult {
  incident_ids: number[];
  created_count: number;
  failed_count: number;
  errors?: string[];
}

export interface FileOperationResult {
  success: boolean;
  message?: string;
}

export class SolutionServerClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolutionServerClientError";
  }
}

export class SolutionServerClient {
  private mcpClient: Client | null = null;
  private serverUrl: string;
  private isConnected: boolean = false;
  private enabled: boolean;
  private currentClientId: string = "";

  constructor(serverUrl: string, enabled: boolean = true) {
    this.serverUrl = serverUrl;
    this.enabled = enabled;
  }

  public async connect(): Promise<void> {
    if (!this.enabled) {
      console.log("Solution server is disabled, skipping connection");
      return;
    }

    this.mcpClient = new Client(
      {
        name: "konveyor-vscode-extension",
        version: "1.0.0",
      },
      {
        capabilities: {
          roots: {
            listChanged: false,
          },
          sampling: {},
        },
      },
    );

    try {
      await this.mcpClient?.connect(new StreamableHTTPClientTransport(new URL(this.serverUrl)));
      console.log("Connected to MCP solution server");
      this.isConnected = true;
    } catch (error) {
      console.error(`Failed to connect to MCP solution server: ${error}`);
      this.isConnected = false;
      throw error;
    }

    try {
      const { tools, resources } = await this.getServerCapabilities();
      console.log(`Available tools: ${tools.map((t: any) => t.name).join(", ")}`);
      console.log(`Available resources: ${resources.map((r: any) => r.name).join(", ")}`);

      console.log("MCP solution server initialized successfully");
    } catch (error) {
      console.error(`Failed to initialize MCP solution server: ${error}`);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.enabled) {
      console.log("Solution server is disabled, skipping disconnect");
      return;
    }

    console.log("Disconnecting from MCP solution server...");

    try {
      if (this.mcpClient) {
        await this.mcpClient.close();
        this.mcpClient = null;
      }

      this.isConnected = false;
      console.log("Disconnected from MCP solution server");
    } catch (error) {
      console.error(`Error during disconnect: ${error}`);
    }
  }

  public setClientId(clientId: string): void {
    this.currentClientId = clientId;
  }

  public getClientId(): string {
    return this.currentClientId;
  }

  public async getServerCapabilities(): Promise<any> {
    if (!this.mcpClient || !this.isConnected) {
      throw new SolutionServerClientError("Solution server is not connected");
    }

    try {
      const { tools } = await this.mcpClient.listTools();
      const { resources } = await this.mcpClient.listResources();

      return {
        tools,
        resources,
      };
    } catch (error) {
      console.error(`Failed to get server capabilities: ${error}`);
      throw error;
    }
  }

  public async getSuccessRate(incidents: EnhancedIncident[]): Promise<EnhancedIncident[]> {
    if (!this.enabled) {
      console.log("Solution server is disabled, returning incidents without success rate");
      return incidents;
    }

    try {
      // Cache to store success rate results for each violation combination
      const successRateCache = new Map<string, SuccessRateMetric | null>();
      const enhancedIncidents: EnhancedIncident[] = [];
      let violationsWithData = 0;
      let totalUniqueViolations = 0;

      for (const incident of incidents) {
        const enhancedIncident = { ...incident };

        if (incident.ruleset_name && incident.violation_name) {
          const key = `${incident.ruleset_name}::${incident.violation_name}`;

          // Check if we've already fetched success rate for this violation combination
          if (!successRateCache.has(key)) {
            totalUniqueViolations++;
            console.log(`Fetching success rate for: ${key}`);

            try {
              const result = await this.mcpClient!.callTool({
                name: "get_success_rate",
                arguments: {
                  violation_ids: [
                    {
                      ruleset_name: incident.ruleset_name,
                      violation_name: incident.violation_name,
                    },
                  ],
                },
              });

              let successRateMetric: SuccessRateMetric | null = null;

              console.debug(JSON.stringify(result));
              if (result.content && Array.isArray(result.content) && result.content.length > 0) {
                for (const chunk of result.content) {
                  if ("text" in chunk) {
                    const content = chunk.text as string;
                    try {
                      const parsed = JSON.parse(content);
                      if (parsed && typeof parsed === "object") {
                        successRateMetric = parsed as SuccessRateMetric;
                        violationsWithData++;
                      }
                    } catch (parseError) {
                      console.error(
                        `Failed to parse success rate response for ${key}: ${parseError}`,
                      );
                    }
                    break;
                  }
                }
              }

              // Cache the result (even if null)
              successRateCache.set(key, successRateMetric);
            } catch (error) {
              console.error(`Error fetching success rate for ${key}: ${error}`);
            }
          }

          // Apply the cached result to the incident
          const cachedResult = successRateCache.get(key);
          if (cachedResult) {
            enhancedIncident.successRateMetric = cachedResult;
          }
        }

        enhancedIncidents.push(enhancedIncident);
      }

      console.log(
        `Success rate summary: ${violationsWithData}/${totalUniqueViolations} unique violations had data`,
      );
      return enhancedIncidents;
    } catch (error) {
      console.error(`Error getting success rate for violations: ${error}`);
      throw error;
    }
  }

  public async createIncident(enhancedIncident: EnhancedIncident): Promise<number> {
    if (!this.enabled) {
      console.log("Solution server is disabled, returning dummy incident ID");
      return -1; // Return a dummy ID when disabled
    }

    try {
      console.log(
        `Creating incident for violation: ${enhancedIncident.ruleset_name} - ${enhancedIncident.violation_name}`,
      );

      const result = await this.mcpClient!.callTool({
        name: "create_incident",
        arguments: {
          client_id: this.currentClientId,
          extended_incident: enhancedIncident,
        },
      });

      let incidentId: number | undefined;

      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        for (const chunk of result.content) {
          if ("text" in chunk) {
            const content = chunk.text as string;
            incidentId = parseInt(content, 10);
            if (isNaN(incidentId)) {
              throw new Error(`Invalid incident ID returned: ${content}`);
            }
            break;
          }
        }
      }

      if (incidentId === undefined) {
        throw new Error("No incident ID returned from server");
      }

      console.log(`Successfully created incident with ID: ${incidentId}`);

      return incidentId;
    } catch (error) {
      console.error(
        `Error creating incident for violation ${enhancedIncident.ruleset_name} - ${enhancedIncident.violation_name}: ${error}`,
      );
      throw error;
    }
  }

  public async createMultipleIncidents(
    enhancedIncidents: EnhancedIncident[],
  ): Promise<CreateMultipleIncidentsResult> {
    if (!this.enabled) {
      console.log("Solution server is disabled, returning dummy incident IDs");
      return {
        incident_ids: enhancedIncidents.map(() => -1),
        created_count: enhancedIncidents.length,
        failed_count: 0,
      };
    }

    try {
      console.log(`Creating ${enhancedIncidents.length} incidents in bulk`);

      const result = await this.mcpClient!.callTool({
        name: "create_multiple_incidents",
        arguments: {
          client_id: this.currentClientId,
          extended_incidents: enhancedIncidents,
        },
      });

      let bulkResult: CreateMultipleIncidentsResult | undefined;

      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        for (const chunk of result.content) {
          if ("text" in chunk) {
            const content = chunk.text as string;
            try {
              const parsed = JSON.parse(content);
              if (
                parsed &&
                typeof parsed === "object" &&
                "incident_ids" in parsed &&
                Array.isArray(parsed.incident_ids)
              ) {
                bulkResult = parsed as CreateMultipleIncidentsResult;
              }
            } catch {
              console.error(`Failed to parse bulk incident creation response: ${content}`);
              throw new Error(`Invalid bulk incident creation response: ${content}`);
            }
            break;
          }
        }
      }

      if (!bulkResult) {
        console.log("No bulk incident creation result returned from server");
        return {
          incident_ids: enhancedIncidents.map(() => -1),
          created_count: 0,
          failed_count: enhancedIncidents.length,
        };
      }

      console.log(
        `Successfully created ${bulkResult.created_count} incidents, ${bulkResult.failed_count} failed`,
      );

      return bulkResult;
    } catch (error) {
      console.error(`Error creating multiple incidents: ${error}`);
      throw error;
    }
  }

  public async createSolution(
    incidentIds: number[],
    before: SolutionFile[],
    after: SolutionFile[],
    reasoning: string,
    usedHintIds: number[],
  ): Promise<number> {
    if (!this.enabled) {
      console.log("Solution server is disabled, returning dummy solution ID");
      return -1; // Return a dummy ID when disabled
    }

    console.log(`Creating solution for incident IDs: ${incidentIds.join(", ")}`);
    console.debug(`Before: ${JSON.stringify(before)}`);
    console.debug(`After: ${JSON.stringify(after)}`);
    console.debug(`Reasoning: ${reasoning}`);
    console.debug(`Used hint IDs: ${usedHintIds.join(", ")}`);

    try {
      const result = await this.mcpClient!.callTool({
        name: "create_solution",
        arguments: {
          client_id: this.currentClientId,
          incident_ids: incidentIds,
          before: before,
          after: after,
          reasoning: reasoning,
          used_hint_ids: usedHintIds,
        },
      });

      let solutionId: number | undefined;

      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        for (const chunk of result.content) {
          if ("text" in chunk) {
            const content = chunk.text as string;
            solutionId = parseInt(content, 10);
            if (isNaN(solutionId)) {
              throw new Error(`Invalid solution ID returned: ${content}`);
            }
            break;
          }
        }
      }

      if (solutionId === undefined) {
        throw new Error("No solution ID returned from server");
      }

      console.log(`Successfully created solution with ID: ${solutionId}`);

      return solutionId;
    } catch (error) {
      console.error(`Error creating solution for incident IDs ${incidentIds.join(", ")}: ${error}`);
      throw error;
    }
  }

  public async getBestHint(
    rulesetName: string,
    violationName: string,
  ): Promise<GetBestHintResult | undefined> {
    if (!this.enabled) {
      console.log("Solution server is disabled, no hint available");
      return undefined;
    }

    try {
      console.log(`Getting best hint for violation: ${rulesetName} - ${violationName}`);

      const result = await this.mcpClient!.callTool({
        name: "get_best_hint",
        arguments: {
          ruleset_name: rulesetName,
          violation_name: violationName,
        },
      });

      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        for (const chunk of result.content) {
          if ("text" in chunk) {
            const content = chunk.text as string;
            // If content is empty or "null", treat as no hint found
            if (content && content.trim() !== "" && content.toLowerCase() !== "null") {
              try {
                // Parse the JSON response
                const parsed = JSON.parse(content);
                if (
                  parsed &&
                  typeof parsed === "object" &&
                  "hint" in parsed &&
                  "hint_id" in parsed
                ) {
                  console.log(`Found best hint for violation ${rulesetName} - ${violationName}`);
                  return {
                    hint: parsed.hint,
                    hint_id: parsed.hint_id,
                  };
                }
              } catch (parseError) {
                console.error(`Failed to parse best hint response: ${parseError}`);
                return undefined;
              }
            }
            break;
          }
        }
      }

      console.log(`No hint found for violation ${rulesetName} - ${violationName}`);
      return undefined;
    } catch (error) {
      console.error(
        `Error getting best hint for violation ${rulesetName} - ${violationName}: ${error}`,
      );
      throw error;
    }
  }

  public async acceptFile(clientId: string, uri: string, content: string): Promise<void> {
    if (!this.enabled) {
      console.log("Solution server is disabled, skipping accept_file");
      return;
    }

    try {
      console.log(`Accepting file: ${uri}`);

      await this.mcpClient!.callTool({
        name: "accept_file",
        arguments: {
          client_id: clientId,
          solution_file: {
            uri: uri,
            content: content,
          },
        },
      });

      console.log(`File accepted successfully: ${uri}`);
    } catch (error) {
      console.error(`Error accepting file ${uri}: ${error}`);
      throw error;
    }
  }

  public async rejectFile(clientId: string, uri: string): Promise<void> {
    if (!this.enabled) {
      console.log("Solution server is disabled, skipping reject_file");
      return;
    }

    try {
      console.log(`Rejecting file: ${uri}`);

      await this.mcpClient!.callTool({
        name: "reject_file",
        arguments: {
          client_id: clientId,
          file_uri: uri,
        },
      });

      console.log(`File rejected successfully: ${uri}`);
    } catch (error) {
      console.error(`Error rejecting file ${uri}: ${error}`);
      throw error;
    }
  }
}
