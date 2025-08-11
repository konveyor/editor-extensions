import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EnhancedIncident, SuccessRateMetric } from "@editor-extensions/shared";
import { Logger } from "winston";

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
  private logger: Logger;

  constructor(serverUrl: string, enabled: boolean = true, logger: Logger) {
    this.serverUrl = serverUrl;
    this.enabled = enabled;
    this.logger = logger.child({
      component: "SolutionServerClient",
    });
  }

  public async connect(): Promise<void> {
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, skipping connection");
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
      this.logger.info("Connected to MCP solution server");
      this.isConnected = true;
    } catch (error) {
      this.logger.error("Failed to connect to MCP solution server", error);
      this.isConnected = false;
      throw error;
    }

    try {
      const { tools, resources } = await this.getServerCapabilities();
      this.logger.info(`Available tools: ${tools.map((t: any) => t.name).join(", ")}`);
      this.logger.info(`Available resources: ${resources.map((r: any) => r.name).join(", ")}`);

      this.logger.info("MCP solution server initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize MCP solution server", error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, skipping disconnect");
      return;
    }

    this.logger.info("Disconnecting from MCP solution server...");

    try {
      if (this.mcpClient) {
        await this.mcpClient.close();
        this.mcpClient = null;
      }

      this.isConnected = false;
      this.logger.info("Disconnected from MCP solution server");
    } catch (error) {
      this.logger.error("Error during disconnect", error);
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
      this.logger.error("Failed to get server capabilities", error);
      throw error;
    }
  }

  public async getSuccessRate(incidents: EnhancedIncident[]): Promise<EnhancedIncident[]> {
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, returning incidents without success rate");
      return incidents;
    }

    if (!this.mcpClient || !this.isConnected) {
      this.logger.error(
        "Get success rate called but solution server is not connected. Maybe the server is not running?",
      );
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
            this.logger.info(`Fetching success rate for: ${key}`);

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

              this.logger.debug(JSON.stringify(result));
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
                      this.logger.error(
                        `Failed to parse success rate response for ${key}`,
                        parseError,
                      );
                    }
                    break;
                  }
                }
              }

              // Cache the result (even if null)
              successRateCache.set(key, successRateMetric);
            } catch (error) {
              this.logger.error(`Error fetching success rate for ${key}`, error);
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

      this.logger.info(
        `Success rate summary: ${violationsWithData}/${totalUniqueViolations} unique violations had data`,
      );
      return enhancedIncidents;
    } catch (error) {
      this.logger.error("Error getting success rate for violations", error);
      throw error;
    }
  }

  public async createIncident(enhancedIncident: EnhancedIncident): Promise<number> {
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, returning dummy incident ID");
      return -1; // Return a dummy ID when disabled
    }

    if (!this.mcpClient || !this.isConnected) {
      this.logger.error(
        "Create incident called but solution server is not connected. Maybe the server is not running?",
      );
      return -1;
    }

    if (!this.currentClientId) {
      this.logger.error("Create incident called but client ID is not set");
      return -1;
    }

    try {
      this.logger.info(
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

      this.logger.info(`Successfully created incident with ID: ${incidentId}`);

      return incidentId;
    } catch (error) {
      this.logger.error(
        `Error creating incident for violation ${enhancedIncident.ruleset_name} - ${enhancedIncident.violation_name}: ${error}`,
      );
      throw error;
    }
  }

  public async createMultipleIncidents(
    enhancedIncidents: EnhancedIncident[],
  ): Promise<CreateMultipleIncidentsResult> {
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, returning dummy incident IDs");
      return {
        incident_ids: enhancedIncidents.map(() => -1),
        created_count: enhancedIncidents.length,
        failed_count: 0,
      };
    }

    if (!this.mcpClient || !this.isConnected) {
      this.logger.error(
        "Create multiple incidents called but solution server is not connected. Maybe the server is not running?",
      );
      return {
        incident_ids: enhancedIncidents.map(() => -1),
        created_count: 0,
        failed_count: enhancedIncidents.length,
      };
    }

    if (!this.currentClientId) {
      this.logger.error("Create multiple incidents called but client ID is not set");
      return {
        incident_ids: enhancedIncidents.map(() => -1),
        created_count: 0,
        failed_count: enhancedIncidents.length,
      };
    }

    try {
      this.logger.info(`Creating ${enhancedIncidents.length} incidents in bulk`);

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
              this.logger.error(`Failed to parse bulk incident creation response: ${content}`);
              throw new Error(`Invalid bulk incident creation response: ${content}`);
            }
            break;
          }
        }
      }

      if (!bulkResult) {
        this.logger.info("No bulk incident creation result returned from server");
        return {
          incident_ids: enhancedIncidents.map(() => -1),
          created_count: 0,
          failed_count: enhancedIncidents.length,
        };
      }

      this.logger.info(
        `Successfully created ${bulkResult.created_count} incidents, ${bulkResult.failed_count} failed`,
      );

      return bulkResult;
    } catch (error) {
      this.logger.error("Error creating multiple incidents", error);
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
      this.logger.info("Solution server is disabled, returning dummy solution ID");
      return -1; // Return a dummy ID when disabled
    }

    if (!this.mcpClient || !this.isConnected) {
      this.logger.error(
        "Create solution called but solution server is not connected. Maybe the server is not running?",
      );
      return -1;
    }

    if (!this.currentClientId) {
      this.logger.error("Create solution called but client ID is not set");
      return -1;
    }

    this.logger.info(`Creating solution for incident IDs: ${incidentIds.join(", ")}`);
    this.logger.debug(`Before: ${JSON.stringify(before)}`);
    this.logger.debug(`After: ${JSON.stringify(after)}`);
    this.logger.debug(`Reasoning: ${reasoning}`);
    this.logger.debug(`Used hint IDs: ${usedHintIds.join(", ")}`);

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

      this.logger.info(`Successfully created solution with ID: ${solutionId}`);

      return solutionId;
    } catch (error) {
      this.logger.error(
        `Error creating solution for incident IDs ${incidentIds.join(", ")}`,
        error,
      );
      throw error;
    }
  }

  public async getBestHint(
    rulesetName: string,
    violationName: string,
  ): Promise<GetBestHintResult | undefined> {
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, no hint available");
      return undefined;
    }

    if (!this.mcpClient || !this.isConnected) {
      this.logger.error(
        "Get best hint called but solution server is not connected. Maybe the server is not running?",
      );
      return undefined;
    }

    try {
      this.logger.info(`Getting best hint for violation: ${rulesetName} - ${violationName}`);

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
                  this.logger.info(
                    `Found best hint for violation ${rulesetName} - ${violationName}`,
                  );
                  return {
                    hint: parsed.hint,
                    hint_id: parsed.hint_id,
                  };
                }
              } catch (parseError) {
                this.logger.error(`Failed to parse best hint response`, parseError);
                return undefined;
              }
            }
            break;
          }
        }
      }

      this.logger.info(`No hint found for violation ${rulesetName} - ${violationName}`);
      return undefined;
    } catch (error) {
      this.logger.error(
        `Error getting best hint for violation ${rulesetName} - ${violationName}: ${error}`,
      );
      throw error;
    }
  }

  public async acceptFile(uri: string, content: string): Promise<void> {
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, skipping accept_file");
      return;
    }

    if (!this.mcpClient || !this.isConnected) {
      this.logger.error(
        "Accept file called but solution server is not connected. Maybe the server is not running?",
      );
      return;
    }

    try {
      this.logger.info(`Accepting file: ${uri}`);

      await this.mcpClient!.callTool({
        name: "accept_file",
        arguments: {
          client_id: this.currentClientId,
          solution_file: {
            uri: uri,
            content: content,
          },
        },
      });

      this.logger.info(`File accepted successfully: ${uri}`);
    } catch (error) {
      this.logger.error(`Error accepting file ${uri}: ${error}`);
      throw error;
    }
  }

  public async rejectFile(uri: string): Promise<void> {
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, skipping reject_file");
      return;
    }

    if (!this.mcpClient || !this.isConnected) {
      this.logger.error(
        "Reject file called but solution server is not connected. Maybe the server is not running?",
      );
      return;
    }

    try {
      this.logger.info(`Rejecting file: ${uri}`);

      await this.mcpClient!.callTool({
        name: "reject_file",
        arguments: {
          client_id: this.currentClientId,
          file_uri: uri,
        },
      });

      this.logger.info(`File rejected successfully: ${uri}`);
    } catch (error) {
      this.logger.error(`Error rejecting file ${uri}: ${error}`);
      throw error;
    }
  }
}
