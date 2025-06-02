import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EnhancedIncident, SuccessRateMetric } from "@editor-extensions/shared";

export interface SolutionFile {
  uri: string;
  content: string;
}

export interface SolutionChangeSet {
  diff: string;
  before: SolutionFile[];
  after: SolutionFile[];
}

export interface GetBestHintResult {
  hint: string;
  hint_id: number;
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

    if (!this.enabled) {
      console.log("MCP Solution Server Client initialized (disabled)");
      return;
    }

    // Create MCP client
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
    console.log("MCP Solution Server Client initialized");
  }

  public async connect(): Promise<void> {
    if (!this.enabled) {
      console.log("Solution server is disabled, skipping connection");
      return;
    }

    if (!this.mcpClient) {
      throw new SolutionServerClientError("MCP client not initialized");
    }

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
      // List available tools/resources
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

    if (!this.mcpClient || !this.isConnected) {
      throw new SolutionServerClientError("Solution server is not connected");
    }

    try {
      // Extract unique violation IDs from incidents
      const violationMap = new Map<string, { ruleset_name: string; violation_name: string }>();
      const incidentsByViolation = new Map<string, EnhancedIncident[]>();

      for (const incident of incidents) {
        if (incident.ruleset_name && incident.violation_name) {
          const key = `${incident.ruleset_name}::${incident.violation_name}`;
          violationMap.set(key, {
            ruleset_name: incident.ruleset_name,
            violation_name: incident.violation_name,
          });

          if (!incidentsByViolation.has(key)) {
            incidentsByViolation.set(key, []);
          }
          incidentsByViolation.get(key)!.push(incident);
        }
      }

      const violationIds = Array.from(violationMap.values());

      if (violationIds.length === 0) {
        console.error("No valid violations found for success rate calculation");
        return incidents;
      }

      console.log(`Requesting success rate for ${violationIds.length} unique violations`);

      const result = await this.mcpClient.callTool({
        name: "get_success_rate",
        arguments: {
          violation_ids: violationIds,
        },
      });

      let successRateMetrics: SuccessRateMetric[] = [];

      if (result.content && Array.isArray(result.content) && result.content.length > 0) {
        for (const chunk of result.content) {
          if ("text" in chunk) {
            const content = chunk.text as string;
            try {
              // Parse the JSON response
              const parsed = JSON.parse(content);
              if (Array.isArray(parsed)) {
                successRateMetrics = parsed as SuccessRateMetric[];
              } else if (parsed === null || parsed === undefined) {
                successRateMetrics = [];
              }
            } catch (parseError) {
              console.error(`Failed to parse success rate response: ${parseError}`);
              successRateMetrics = [];
            }
            break;
          }
        }
      }

      console.log(`Received success rate metrics for ${successRateMetrics.length} violations`);

      // Create a copy of incidents with success rate metrics attached
      const enhancedIncidents: EnhancedIncident[] = [];
      const violationKeys = Array.from(violationMap.keys());

      for (const incident of incidents) {
        const enhancedIncident = { ...incident };

        if (incident.ruleset_name && incident.violation_name) {
          const key = `${incident.ruleset_name}::${incident.violation_name}`;
          const violationIndex = violationKeys.indexOf(key);

          if (violationIndex >= 0 && violationIndex < successRateMetrics.length) {
            enhancedIncident.successRateMetric = successRateMetrics[violationIndex];
          }
        }

        enhancedIncidents.push(enhancedIncident);
      }

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

    if (!this.mcpClient || !this.isConnected) {
      throw new Error("Solution server is not connected");
    }

    try {
      console.log(
        `Creating incident for violation: ${enhancedIncident.ruleset_name} - ${enhancedIncident.violation_name}`,
      );

      const result = await this.mcpClient.callTool({
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

  public async createSolution(
    incidentIds: number[],
    changeSet: SolutionChangeSet,
    reasoning: string,
    usedHintIds: number[],
  ): Promise<number> {
    if (!this.enabled) {
      console.log("Solution server is disabled, returning dummy solution ID");
      return -1; // Return a dummy ID when disabled
    }

    if (!this.mcpClient || !this.isConnected) {
      throw new Error("Solution server is not connected");
    }

    console.log(`Creating solution for incident IDs: ${incidentIds.join(", ")}`);
    console.log(`Change set: ${JSON.stringify(changeSet)}`);
    console.log(`Reasoning: ${reasoning}`);
    console.log(`Used hint IDs: ${usedHintIds.join(", ")}`);

    try {
      const result = await this.mcpClient.callTool({
        name: "create_solution",
        arguments: {
          client_id: this.currentClientId,
          incident_ids: incidentIds,
          change_set: changeSet,
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

    if (!this.mcpClient || !this.isConnected) {
      throw new Error("Solution server is not connected");
    }

    try {
      console.log(`Getting best hint for violation: ${rulesetName} - ${violationName}`);

      const result = await this.mcpClient.callTool({
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
}
