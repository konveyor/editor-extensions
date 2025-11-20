import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { EnhancedIncident, SuccessRateMetric, HubConfig } from "@editor-extensions/shared";
import { Logger } from "winston";
import { Resource, Tool } from "@modelcontextprotocol/sdk/types.js";
import { AIMessageChunk } from "@langchain/core/messages";

import { KaiWorkflowEventEmitter } from "../eventEmitter";
import { KaiWorkflowMessageType } from "../types";

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

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

const TOKEN_EXPIRY_BUFFER_MS = 30000; // 30 second buffer
const REAUTH_DELAY_MS = 5000; // Delay before re-authentication attempt

export class SolutionServerClient extends KaiWorkflowEventEmitter {
  private mcpClient: Client | null = null;
  private enabled: boolean;
  private serverUrl: string;
  private isConnected: boolean = false;
  private authEnabled: boolean;
  private insecure: boolean;
  private realm: string;
  private clientId: string;
  private username: string;
  private password: string;
  private bearerToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private currentClientId: string = "";
  private logger: Logger;
  private sslBypassCleanup: (() => void) | null = null;

  private isRefreshingTokens: boolean = false;
  private refreshRetryCount: number = 0;
  private cachedCapabilities: SolutionServerCapabilities | null = null;

  constructor(config: HubConfig, logger: Logger) {
    super();
    this.enabled = config.enabled && config.features.solutionServer.enabled;
    this.serverUrl = config.url;
    this.authEnabled = config.auth.enabled;
    this.insecure = config.auth.insecure;
    this.realm = config.auth.realm;
    this.clientId = `${this.realm}-ui`;
    this.username = "";
    this.password = "";
    this.logger = logger.child({
      component: "SolutionServerClient",
    });
    // Clear auth-related properties if auth is disabled
    if (!this.authEnabled) {
      this.realm = "";
      this.clientId = "";
      this.insecure = false;
      this.bearerToken = null;
      this.refreshToken = null;
      this.tokenExpiresAt = null;
      this.clearTokenRefreshTimer();
    }
  }

  public updateConfig(config: HubConfig): void {
    this.enabled = config.enabled && config.features.solutionServer.enabled;
    this.serverUrl = config.url;
    this.authEnabled = config.auth.enabled;
    this.insecure = config.auth.insecure;
    this.realm = config.auth.realm;
    this.clientId = `${this.realm}-ui`;
    // Clear auth-related properties if auth is disabled
    if (!this.authEnabled) {
      this.realm = "";
      this.clientId = "";
      this.insecure = false;
      this.bearerToken = null;
      this.refreshToken = null;
      this.tokenExpiresAt = null;
      this.clearTokenRefreshTimer();
    }
    this.logger.info("Solution server configuration updated");
  }

  public async authenticate(username: string, password: string): Promise<void> {
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, skipping authentication");
      return;
    }

    if (!this.authEnabled) {
      this.logger.info("Authentication is disabled");
      return;
    }

    if (!username || !password) {
      throw new SolutionServerClientError("No username or password provided");
    }

    this.username = username;
    this.password = password;

    // Clear any existing tokens to force fresh authentication with new credentials
    this.bearerToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = null;
    this.clearTokenRefreshTimer();

    this.logger.info("Credentials stored for authentication");
  }

  public async connect(): Promise<void> {
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, skipping connection");
      return;
    }

    // Apply SSL bypass for development/testing if insecure flag is enabled
    if (this.insecure) {
      this.sslBypassCleanup = this.applySSLBypass();
    }

    // Handle authentication if required
    if (this.authEnabled) {
      // Only require credentials if we don't yet have a token
      if (!this.bearerToken && (!this.username || !this.password)) {
        throw new SolutionServerClientError("No credentials available. Call authenticate() first.");
      }
      // Exchange for tokens if we don't have one
      if (!this.bearerToken) {
        try {
          await this.exchangeForTokens();
        } catch (error) {
          this.logger.error("Failed to exchange for tokens", error);
          throw error;
        }
      }

      // Ensure refresh timer is running (also after manual restarts)
      this.startTokenRefreshTimer();
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

    if (this.authEnabled && this.bearerToken) {
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
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, skipping disconnect");
      return;
    }

    this.logger.info("Disconnecting from MCP solution server...");

    // Clear refresh timer
    this.clearTokenRefreshTimer();

    this.cachedCapabilities = null;

    // Restore SSL settings
    if (this.sslBypassCleanup) {
      this.sslBypassCleanup();
      this.sslBypassCleanup = null;
    }

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
    if (!this.enabled) {
      this.logger.info("Solution server is disabled, returning empty capabilities");
      return {
        tools: [],
        resources: [],
      };
    }
    if (!this.mcpClient || !this.isConnected) {
      throw new SolutionServerClientError("Solution server is not connected");
    }
    if (this.isRefreshingTokens) {
      this.logger.info("Solution server is refreshing tokens, returning empty capabilities");
      return {
        tools: [],
        resources: [],
      };
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
          authEnabled: this.authEnabled,
          hasToken: !!this.bearerToken,
          tokenExpiresAt: this.tokenExpiresAt,
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
            authEnabled: this.authEnabled,
            hasToken: !!this.bearerToken,
            tokenExpiresAt: this.tokenExpiresAt,
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

  private async exchangeForTokens(): Promise<void> {
    if (!this.username || !this.password) {
      throw new SolutionServerClientError("No username or password available for token exchange");
    }

    const url = new URL(this.serverUrl);
    const keycloakUrl = `${url.protocol}//${url.host}/auth`;
    const tokenUrl = `${keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

    const params = new URLSearchParams();
    params.append("grant_type", "password");
    params.append("client_id", this.clientId);
    params.append("username", this.username);
    params.append("password", this.password);

    try {
      this.logger.debug(`Attempting token exchange with ${tokenUrl}`);

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Token exchange failed: ${response.status} ${response.statusText}`,
          errorText,
        );
        throw new SolutionServerClientError(
          `Authentication failed: ${response.status} ${response.statusText}`,
        );
      }

      const tokenResponse = (await response.json()) as TokenResponse;
      this.logger.info("Token exchange successful");

      this.bearerToken = tokenResponse.access_token;
      this.refreshToken = tokenResponse.refresh_token || null;
      this.tokenExpiresAt = Date.now() + tokenResponse.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;
    } catch (error) {
      this.logger.error("Token exchange failed", error);
      if (error instanceof SolutionServerClientError) {
        throw error;
      }
      throw new SolutionServerClientError(
        `Token exchange failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async refreshTokens(): Promise<void> {
    if (!this.refreshToken) {
      this.logger.warn("No refresh token available, cannot refresh");
      return;
    }

    if (this.isRefreshingTokens) {
      this.logger.debug("Token refresh already in progress");
      return;
    }

    // Retry configuration - local constants
    const maxRefreshRetries = 3;
    const baseRetryDelayMs = 1000; // Start with 1 second
    // Cancel any pending timers to avoid overlapping refreshes
    this.clearTokenRefreshTimer();
    this.isRefreshingTokens = true;
    const url = new URL(this.serverUrl);
    const keycloakUrl = `${url.protocol}//${url.host}/auth`;
    const tokenUrl = `${keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("client_id", this.clientId);
    params.append("refresh_token", this.refreshToken);

    try {
      this.logger.debug(`Attempting token refresh with ${tokenUrl}`);

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Token refresh failed: ${response.status} ${response.statusText}`,
          errorText,
        );
        throw new SolutionServerClientError(
          `Token refresh failed: ${response.status} ${response.statusText}`,
        );
      }

      const tokenResponse = (await response.json()) as TokenResponse;
      this.logger.info("Token refresh successful");

      this.bearerToken = tokenResponse.access_token;
      this.refreshToken = tokenResponse.refresh_token || this.refreshToken;
      this.tokenExpiresAt = Date.now() + tokenResponse.expires_in * 1000 - TOKEN_EXPIRY_BUFFER_MS;

      if (this.isConnected) {
        this.logger.info("Reconnecting to MCP solution server");
        try {
          await this.disconnect();
          await this.connect();
        } catch (error) {
          this.logger.error("Error reconnecting to MCP solution server", error);
        }
      }

      // Success case - reset retry counter and start normal timer
      this.refreshRetryCount = 0;
      this.startTokenRefreshTimer();
    } catch (error) {
      this.logger.error("Token refresh failed", error);

      // Determine if error is retryable
      const isRetryable = this.isRetryableRefreshError(error);

      if (isRetryable && this.refreshRetryCount < maxRefreshRetries) {
        this.refreshRetryCount++;
        const delayMs = baseRetryDelayMs * Math.pow(2, this.refreshRetryCount - 1);

        this.logger.warn(
          `Token refresh failed (attempt ${this.refreshRetryCount}/${maxRefreshRetries}), retrying in ${delayMs}ms`,
        );

        // Schedule retry with exponential backoff
        this.refreshTimer = setTimeout(() => {
          this.refreshTokens().catch((error) => {
            this.logger.error("Retry token refresh failed", error);
          });
        }, delayMs);
      } else {
        // Non-retryable error or max retries exceeded
        this.refreshRetryCount = 0;
        this.logger.error(
          `Token refresh failed permanently: ${isRetryable ? "max retries exceeded" : "non-retryable error"}`,
        );

        // Clear the refresh timer to break any potential retry loops
        this.clearTokenRefreshTimer();

        // Clear the invalid tokens
        this.bearerToken = null;
        this.refreshToken = null;
        this.tokenExpiresAt = null;

        // Attempt full re-authentication if credentials are available
        if (this.username && this.password) {
          this.logger.info(
            `Attempting full re-authentication after permanent refresh failure in ${REAUTH_DELAY_MS}ms`,
          );
          this.refreshTimer = setTimeout(() => {
            this.exchangeForTokens()
              .then(async () => {
                this.logger.info("Re-authentication successful, reconnecting...");
                if (this.isConnected) {
                  await this.disconnect();
                }
                await this.connect();
              })
              .catch((error) => {
                this.logger.error("Re-authentication failed after token refresh failure", error);
              });
          }, REAUTH_DELAY_MS);
        } else {
          this.logger.error(
            "Cannot recover from token refresh failure: no credentials available for re-authentication",
          );
        }
      }
    } finally {
      this.isRefreshingTokens = false;
    }
  }

  private startTokenRefreshTimer(): void {
    this.clearTokenRefreshTimer();

    if (!this.tokenExpiresAt) {
      this.logger.warn("No token expiration time available, cannot start refresh timer");
      return;
    }

    const now = Date.now();
    const timeUntilRefresh = this.tokenExpiresAt - now;

    if (timeUntilRefresh <= 0) {
      // Token already expired, refresh immediately
      this.refreshTokens().catch((error) => {
        this.logger.error("Immediate token refresh failed", error);
      });
      return;
    }

    this.logger.info(`Starting token refresh timer, will refresh in ${timeUntilRefresh}ms`);
    this.refreshTimer = setTimeout(() => {
      this.refreshTokens().catch((error) => {
        this.logger.error("Token refresh timer failed", error);
      });
    }, timeUntilRefresh);
  }

  private clearTokenRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private isRetryableRefreshError(error: any): boolean {
    if (error instanceof SolutionServerClientError) {
      // Check if it's an HTTP 400/401 (bad/expired refresh token)
      const message = error.message.toLowerCase();
      if (
        message.includes("400") ||
        message.includes("401") ||
        message.includes("invalid_grant") ||
        message.includes("unauthorized")
      ) {
        return false; // Non-retryable - token is likely permanently invalid
      }
    }

    // Network errors, 5xx server errors, timeouts are retryable
    return true;
  }

  /**
   * Apply SSL bypass for insecure connections (Node.js specific)
   */
  private applySSLBypass(): () => void {
    this.logger.debug("Applying SSL bypass for insecure connections");

    // Store original values
    const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    // Disable SSL verification through environment variable
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    this.logger.warn("SSL certificate verification is disabled");

    // Return cleanup function
    return () => {
      this.logger.debug("Restoring SSL settings");
      if (originalRejectUnauthorized !== undefined) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized;
      } else {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      }
    };
  }
}
