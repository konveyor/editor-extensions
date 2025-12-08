import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EnhancedIncident, SuccessRateMetric } from "@editor-extensions/shared";
import { Logger } from "winston";
import { Resource, Tool } from "@modelcontextprotocol/sdk/types.js";
import { AIMessageChunk } from "@langchain/core/messages";

import { KaiWorkflowEventEmitter } from "../eventEmitter";
import { KaiWorkflowMessageType } from "../types";

// MCP endpoint path for Konveyor Hub solution server
const SOLUTION_SERVER_MCP_PATH = "/hub/services/kai/api";

export interface SolutionServerCapabilities {
  tools: Tool[];
  resources: Resource[];
}

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

/**
 * Client for interacting with the MCP solution server.
 *
 * Note: Authentication is now handled by HubConnectionManager.
 * This class focuses solely on MCP client operations.
 */
export class SolutionServerClient extends KaiWorkflowEventEmitter {
  private mcpClient: Client | null = null;
  private serverUrl: string;
  private bearerToken: string | null;
  private currentClientId: string = "";
  private logger: Logger;
  private cachedCapabilities: SolutionServerCapabilities | null = null;
  public isConnected: boolean = false;

  /**
   * Create a new SolutionServerClient.
   * @param hubUrl The base Hub URL (e.g., https://hub.example.com)
   * @param bearerToken Optional bearer token for authentication
   * @param logger Logger instance
   */
  constructor(hubUrl: string, bearerToken: string | null, logger: Logger) {
    super();
    // Build full MCP endpoint URL from base Hub URL
    const baseUrl = hubUrl.endsWith("/") ? hubUrl.slice(0, -1) : hubUrl;
    this.serverUrl = `${baseUrl}${SOLUTION_SERVER_MCP_PATH}`;
    this.bearerToken = bearerToken;
    this.logger = logger.child({
      component: "SolutionServerClient",
    });
  }

  public async connect(): Promise<void> {
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

    // Try connection with retry logic for trailing slash
    const success = await this.attemptConnectionWithSlashRetry();
    if (!success) {
      await this.disconnect();
      throw new SolutionServerClientError(
        "Failed to connect after trying with and without trailing slash",
      );
    }

    try {
      const { tools } = await this.mcpClient.listTools();
      const { resources } = await this.mcpClient.listResources();

      this.cachedCapabilities = { tools, resources };

      this.logger.info(`Available tools: ${tools.map((t: Tool) => t.name).join(", ")}`);
      this.logger.info(`Available resources: ${resources.map((r: Resource) => r.name).join(", ")}`);

      this.logger.info("MCP solution server initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize MCP solution server", error);
      throw error;
    }
  }

  private async attemptConnectionWithSlashRetry(): Promise<boolean> {
    const transportOptions: any = {};

    if (this.bearerToken) {
      transportOptions.requestInit = {
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
        },
      };
      this.logger.debug("Added bearer token authentication");
    }

    // First attempt with original URL
    try {
      this.logger.debug(`Connecting to MCP server at: ${this.serverUrl}`);
      await this.mcpClient?.connect(
        new StreamableHTTPClientTransport(new URL(this.serverUrl), transportOptions),
      );
      this.logger.info("Connected to MCP solution server");
      this.isConnected = true;
      return true;
    } catch (error) {
      this.logger.warn(`Failed to connect with original URL (${this.serverUrl})`, error);
    }

    // Second attempt with trailing slash behavior toggled
    const alternativeUrl = this.getAlternativeUrl(this.serverUrl);
    if (alternativeUrl !== this.serverUrl) {
      try {
        this.logger.debug(`Retrying connection to MCP server at: ${alternativeUrl}`);
        await this.mcpClient?.connect(
          new StreamableHTTPClientTransport(new URL(alternativeUrl), transportOptions),
        );
        this.logger.info(
          `Connected to MCP solution server using alternative URL: ${alternativeUrl}`,
        );
        this.isConnected = true;
        return true;
      } catch (error) {
        this.logger.error(`Failed to connect with alternative URL (${alternativeUrl})`, error);
      }
    }

    return false;
  }

  private getAlternativeUrl(url: string): string {
    // If URL ends with trailing slash, remove it; if not, add it
    if (url.endsWith("/")) {
      return url.slice(0, -1);
    } else {
      return url + "/";
    }
  }

  public async disconnect(): Promise<void> {
    this.logger.info("Disconnecting from MCP solution server...");

    this.cachedCapabilities = null;

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

  /**
   * Update the bearer token and reconnect if currently connected.
   * This is called after token refresh to ensure the MCP connection uses the new token.
   */
  public async updateBearerToken(newToken: string): Promise<void> {
    const wasConnected = this.isConnected;
    this.logger.info("Updating bearer token", { wasConnected });

    this.bearerToken = newToken;

    if (wasConnected) {
      // Reconnect with new token - MCP SDK uses token during connection setup
      this.logger.info("Reconnecting MCP client with new token");
      await this.disconnect();
      await this.connect();
    }
  }

  /**
   * Closes and cleans up a stale MCP client after connection failure.
   * This is called when we detect the server is unreachable to prevent resource leaks.
   */
  private async closeStaleClient(): Promise<void> {
    if (this.mcpClient) {
      try {
        await this.mcpClient.close();
        this.logger.debug("Closed stale MCP client after connection failure");
      } catch (closeError) {
        this.logger.warn("Error closing stale MCP client:", closeError);
      } finally {
        this.mcpClient = null;
      }
    }

    // Clear cached capabilities since we're disconnected
    this.cachedCapabilities = null;
  }

  public setClientId(clientId: string): void {
    this.currentClientId = clientId;
  }

  public getClientId(): string {
    return this.currentClientId;
  }

  public async getServerCapabilities(
    skipCache: boolean = false,
  ): Promise<SolutionServerCapabilities> {
    if (!this.mcpClient || !this.isConnected) {
      throw new SolutionServerClientError("Solution server is not connected");
    }

    // Return cached capabilities if available to avoid redundant calls (unless skipCache is true)
    if (!skipCache && this.cachedCapabilities) {
      this.logger.debug("Returning cached server capabilities");
      return this.cachedCapabilities;
    }

    try {
      const { tools } = await this.mcpClient.listTools();
      const { resources } = await this.mcpClient.listResources();

      // Cache for future calls
      this.cachedCapabilities = { tools, resources };

      return {
        tools,
        resources,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode =
        error && typeof error === "object" && "cause" in error && error.cause
          ? (error.cause as any)?.code
          : undefined;

      // Check if this is a connection error
      const isConnectionError =
        errorMessage.toLowerCase().includes("fetch failed") ||
        errorMessage.toLowerCase().includes("econnreset") ||
        errorMessage.toLowerCase().includes("econnrefused") ||
        errorMessage.toLowerCase().includes("etimedout") ||
        errorCode === "ECONNRESET" ||
        errorCode === "ECONNREFUSED" ||
        errorCode === "ETIMEDOUT";

      if (isConnectionError) {
        // Connection error - log detailed diagnostic information
        this.logger.error(`Solution server connection failure while getting capabilities`, {
          errorMessage,
          errorCode,
          serverUrl: this.serverUrl,
          isConnected: this.isConnected,
          hasToken: !!this.bearerToken,
          mcpClientExists: !!this.mcpClient,
          fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        });

        // Mark as disconnected
        this.isConnected = false;

        // Close the stale MCP client to prevent resource leaks
        await this.closeStaleClient();

        // Return empty capabilities instead of throwing
        return {
          tools: [],
          resources: [],
        };
      }

      this.logger.error("Failed to get server capabilities", error);
      throw error;
    }
  }

  public async getSuccessRate(incidents: EnhancedIncident[]): Promise<EnhancedIncident[]> {
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
    if (!this.mcpClient || !this.isConnected) {
      this.logger.error(
        "Get best hint called but solution server is not connected. Maybe the server is not running?",
      );
      return undefined;
    }

    try {
      this.logger.info(`Getting best hint for violation: ${rulesetName} - ${violationName}`);

      // Emit message that we're querying the solution server for a hint
      this.emitWorkflowMessage({
        id: `solution-server-hint-query-${Date.now()}-${rulesetName}-${violationName}`,
        type: KaiWorkflowMessageType.LLMResponseChunk,
        data: new AIMessageChunk(
          `🔍 Querying solution server for hints about: **${violationName}**`,
        ),
      });

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

                  // Emit message showing the hint that was found
                  this.emitWorkflowMessage({
                    id: `solution-server-hint-found-${Date.now()}-${rulesetName}-${violationName}`,
                    type: KaiWorkflowMessageType.LLMResponseChunk,
                    data: new AIMessageChunk(
                      `✅ Found solution server hint (ID: ${parsed.hint_id}):\n\n${parsed.hint}`,
                    ),
                  });

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

      // Emit message that no hint was found
      this.emitWorkflowMessage({
        id: `solution-server-hint-not-found-${Date.now()}-${rulesetName}-${violationName}`,
        type: KaiWorkflowMessageType.LLMResponseChunk,
        data: new AIMessageChunk(`ℹ️ No hint found in solution server for: **${violationName}**`),
      });

      return undefined;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode =
        error && typeof error === "object" && "cause" in error && error.cause
          ? (error.cause as any)?.code
          : undefined;

      // Check if this is a "not found" error rather than a connection/server error
      const isNotFoundError =
        errorMessage.toLowerCase().includes("not found") ||
        errorMessage.toLowerCase().includes("does not exist") ||
        errorMessage.toLowerCase().includes("not in the database");

      // Check if this is a connection error
      const isConnectionError =
        errorMessage.toLowerCase().includes("fetch failed") ||
        errorMessage.toLowerCase().includes("econnreset") ||
        errorMessage.toLowerCase().includes("econnrefused") ||
        errorMessage.toLowerCase().includes("etimedout") ||
        errorMessage.toLowerCase().includes("network") ||
        errorCode === "ECONNRESET" ||
        errorCode === "ECONNREFUSED" ||
        errorCode === "ETIMEDOUT";

      if (isNotFoundError) {
        // Treat "not found" as a normal case - the violation simply has no hint in the database
        this.logger.info(
          `No hint available in solution server for violation ${rulesetName} - ${violationName} (not in database)`,
        );

        // Emit message that no hint was found (same as successful query with no results)
        this.emitWorkflowMessage({
          id: `solution-server-hint-not-found-${Date.now()}-${rulesetName}-${violationName}`,
          type: KaiWorkflowMessageType.LLMResponseChunk,
          data: new AIMessageChunk(`ℹ️ No hint found in solution server for: **${violationName}**`),
        });

        return undefined;
      }

      if (isConnectionError) {
        // Connection errors should not stop the workflow - log detailed info for debugging
        this.logger.error(
          `Solution server connection failure while getting hint for ${rulesetName} - ${violationName}`,
          {
            errorMessage,
            errorCode,
            serverUrl: this.serverUrl,
            isConnected: this.isConnected,
            hasToken: !!this.bearerToken,
            mcpClientExists: !!this.mcpClient,
            fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
          },
        );

        // Mark as disconnected so future calls will know
        this.isConnected = false;

        // Close the stale MCP client to prevent resource leaks
        await this.closeStaleClient();

        // Emit a warning message instead of an error to allow workflow to continue
        this.emitWorkflowMessage({
          id: `solution-server-hint-connection-issue-${Date.now()}-${rulesetName}-${violationName}`,
          type: KaiWorkflowMessageType.LLMResponseChunk,
          data: new AIMessageChunk(
            `⚠️ Solution server connection failed (${errorCode || "network error"}) - continuing without hint for: **${violationName}**`,
          ),
        });

        // Return undefined to allow workflow to continue without the hint
        return undefined;
      }

      // For other actual errors (auth, permissions, etc.), log and emit error
      this.logger.error(
        `Error getting best hint for violation ${rulesetName} - ${violationName}: ${errorMessage}`,
      );

      // Emit error message for actual errors
      this.emitWorkflowMessage({
        id: `solution-server-hint-error-${Date.now()}-${rulesetName}-${violationName}`,
        type: KaiWorkflowMessageType.Error,
        data: `Error querying solution server: ${errorMessage}`,
      });

      throw error;
    }
  }

  public async acceptFile(uri: string, content: string): Promise<void> {
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
