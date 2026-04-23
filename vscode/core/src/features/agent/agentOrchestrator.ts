import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import {
  EnhancedIncident,
  Scope,
  ChatMessageType,
  AgentContentBlockType,
  getProgrammingLanguageFromUri,
  ToolMessageValue,
} from "@editor-extensions/shared";
import type { ExtensionState } from "../../extensionState";
import type {
  AgentClient,
  ToolCallData,
  StreamingResourceData,
  PermissionRequestData,
} from "../../client/agentClient";
import type { AgentFileTracker } from "./fileTracker";
import { executeExtensionCommand } from "../../commands";
import { routeFileChange } from "./fileChangeRouter";
import { buildMigrationPrompt } from "./promptBuilder";
import { suspendBroadcastHandlers, resumeBroadcastHandlers, pendingPermissions } from "./init";
import { handlePermissionRequest } from "./toolPermissionHandler";
import type { Logger } from "winston";

/**
 * Self-contained orchestrator for the agent-driven "Get Solution" lifecycle.
 *
 * Works with any AgentClient implementation (GooseClient, OpencodeAgentClient).
 * Routes streaming / file-change events into extension state without
 * going through the KaiWorkflow adapter or processMessage pipeline.
 *
 * File changes reach batch review through a single path
 * (routeFileChangeToBatchReview) regardless of which agent backend
 * is active or whether it used MCP or built-in tools.
 */
export class AgentOrchestrator {
  private lastTextMessageId: string | null = null;
  private fileChangesRouted = 0;

  constructor(
    private readonly state: ExtensionState,
    private readonly logger: Logger,
    private readonly incidents: EnhancedIncident[],
  ) {}

  async run(): Promise<void> {
    if (this.state.data.isFetchingSolution) {
      vscode.window.showWarningMessage("Solution already being fetched");
      return;
    }

    const profileName = this.incidents[0]?.activeProfileName;
    if (!profileName) {
      vscode.window.showErrorMessage("No profile name found in incidents");
      return;
    }

    const agentMode = this.state.data.featureState?.agentMode !== false;
    let client: AgentClient | undefined;
    let disposeClient = false;

    if (agentMode) {
      client = this.getAgentClient();
    }

    this.initializeState();
    executeExtensionCommand("showChatPanel");

    this.logger.info("AgentOrchestrator: starting", {
      incidentsCount: this.incidents.length,
      profileName,
      agentMode,
    });

    if (!client) {
      client = await this.createDirectLLMClient();
      disposeClient = true;
    }

    if (!client) {
      this.cleanup();
      return;
    }

    if (agentMode && !disposeClient) {
      await this.runAgentPath(client, profileName, disposeClient);
    } else {
      await this.runWorkflowPath(client, disposeClient);
    }
  }

  private getAgentClient(): AgentClient | undefined {
    const agentClient = this.state.featureClients.get("agentClient") as AgentClient | undefined;
    if (!agentClient || agentClient.getState() !== "running") {
      this.logger.info(
        "AgentOrchestrator: agent client not available, will fall back to direct LLM",
      );
      return undefined;
    }
    return agentClient;
  }

  private async createDirectLLMClient(): Promise<AgentClient | undefined> {
    try {
      const [
        { parseModelConfig, getModelProviderFromConfig },
        { paths },
        { KaiInteractiveWorkflow, FileBasedResponseCache },
        { getConfigKaiDemoMode, getCacheDir },
        { DirectLLMClient },
      ] = await Promise.all([
        import("../../modelProvider"),
        import("../../paths"),
        import("@editor-extensions/agentic"),
        import("../../utilities/configuration"),
        import("../../client/directLLMClient"),
      ]);

      const parsedConfig = await parseModelConfig(paths().settingsYaml);
      const modelProvider = await getModelProviderFromConfig(parsedConfig, this.logger);

      const workflow = new KaiInteractiveWorkflow(this.logger);
      await workflow.init({
        modelProvider,
        workspaceDir: this.state.data.workspaceRoot,
        fsCache: this.state.kaiFsCache,
        solutionServerClient: this.state.hubConnectionManager.getSolutionServerClient(),
        toolCache: new FileBasedResponseCache(
          getConfigKaiDemoMode(),
          (args) =>
            typeof args === "string" ? args : JSON.stringify(args, Object.keys(args).sort()),
          (args) => (typeof args === "string" ? args : JSON.parse(args)),
          getCacheDir(this.state.data.workspaceRoot),
          this.logger,
        ),
      });

      const profileName = this.incidents[0]?.activeProfileName ?? "";
      const programmingLanguage =
        this.incidents.length > 0 ? getProgrammingLanguageFromUri(this.incidents[0].uri) : "Java";

      return new DirectLLMClient({
        workflow,
        workflowInput: {
          incidents: this.incidents,
          migrationHint: profileName,
          programmingLanguage,
          enableAgentMode: false,
        },
        logger: this.logger,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error("AgentOrchestrator: failed to create direct LLM client", { error: msg });
      vscode.window.showErrorMessage(
        `Failed to initialize LLM: ${msg}. Check your provider-settings.yaml configuration.`,
      );
      return undefined;
    }
  }

  /**
   * Agent path: Goose/OpenCode agent with AgentClient event handlers.
   */
  private async runAgentPath(
    agentClient: AgentClient,
    profileName: string,
    disposeClient: boolean,
  ): Promise<void> {
    const fileTracker = this.state.featureClients.get("agentFileTracker") as
      | AgentFileTracker
      | undefined;

    suspendBroadcastHandlers();

    const onChunk = (
      _msgId: string,
      content: string,
      contentType: AgentContentBlockType,
      resourceData?: StreamingResourceData,
    ): void => {
      this.handleStreamingChunk(content, contentType, resourceData);
    };

    const onToolCall = (_msgId: string, data: ToolCallData): void => {
      this.handleToolCall(data);
      if (fileTracker && data.arguments) {
        const workspaceRoot = this.state.data.workspaceRoot;
        fileTracker.cacheFileBeforeWrite(data.name, data.arguments, workspaceRoot, data.callId);
      }
    };

    const onToolCallUpdate = (_msgId: string, data: ToolCallData): void => {
      this.handleToolCallUpdate(data);
      if (fileTracker && data.status === "succeeded") {
        fileTracker.resolvePendingFileChanges().then(async (changes) => {
          for (const change of changes) {
            await routeFileChange(this.state, change.path, change.content, change.originalContent);
            this.fileChangesRouted++;
            this.logger.info("AgentOrchestrator: file change routed", {
              path: change.path,
            });
          }
          if (changes.length > 0 && data.callId) {
            this.markToolAsFileChangeRouted(data.callId);
          }
        }).catch((err) => {
          this.logger.error("AgentOrchestrator: failed to resolve pending file changes", { error: err });
        });
      }
    };

    const onComplete = (_msgId: string, _stopReason: string): void => {
      this.logger.info("AgentOrchestrator: streaming complete", { stopReason: _stopReason });
    };

    const onPermission = (data: PermissionRequestData): void => {
      this.handlePermissionRequest(agentClient, data);
    };

    agentClient.on("streamingChunk", onChunk);
    agentClient.on("toolCall", onToolCall);
    agentClient.on("toolCallUpdate", onToolCallUpdate);
    agentClient.on("streamingComplete", onComplete);
    agentClient.on("permissionRequest", onPermission);

    try {
      if (fileTracker) {
        fileTracker.clear();
      }

      const programmingLanguage =
        this.incidents.length > 0 ? getProgrammingLanguageFromUri(this.incidents[0].uri) : "Java";

      const workspaceRoot = this.state.data.workspaceRoot;

      const [sessionId, fileContentCache] = await Promise.all([
        agentClient.createSession(),
        fileTracker && this.incidents.length > 0
          ? fileTracker.cacheIncidentFiles(this.incidents, workspaceRoot)
          : Promise.resolve(undefined),
      ]);

      this.logger.info("AgentOrchestrator: created new session for getSolution", { sessionId });
      this.state.mutate((draft) => {
        if (draft.solutionScope) {
          draft.solutionScope.agentSessionId = sessionId;
        }
      });

      const prompt = await buildMigrationPrompt(
        {
          incidents: this.incidents,
          migrationHint: profileName,
          programmingLanguage,
          enableAgentMode: true,
        },
        workspaceRoot,
        fileContentCache,
      );

      const requestId = uuidv4();
      await agentClient.sendMessage(prompt, requestId);

      if (fileTracker) {
        const missedChanges = await fileTracker.scanForMissedChanges();
        for (const change of missedChanges) {
          await routeFileChange(this.state, change.path, change.content, change.originalContent);
          this.fileChangesRouted++;
        }
        if (missedChanges.length > 0) {
          this.logger.info(`AgentOrchestrator: routed ${missedChanges.length} post-scan file(s)`);
        }
      }
    } catch (err) {
      this.handleError(err);
    } finally {
      agentClient.removeListener("streamingChunk", onChunk);
      agentClient.removeListener("toolCall", onToolCall);
      agentClient.removeListener("toolCallUpdate", onToolCallUpdate);
      agentClient.removeListener("streamingComplete", onComplete);
      agentClient.removeListener("permissionRequest", onPermission);
      resumeBroadcastHandlers();
      this.cleanup();
      if (disposeClient) {
        agentClient.dispose();
      }
    }
  }

  /**
   * Workflow path: KaiInteractiveWorkflow with processMessage queue.
   * Restores per-file accept/reject via the MessageQueueManager pipeline.
   */
  private async runWorkflowPath(agentClient: AgentClient, disposeClient: boolean): Promise<void> {
    if (!agentClient.getWorkflow) {
      this.logger.error("AgentOrchestrator: workflow path requires a client with getWorkflow()");
      return;
    }

    const workflow = agentClient.getWorkflow();
    const { processMessage } = await import("../../utilities/ModifiedFiles/processMessage");
    const { MessageQueueManager } = await import("../../utilities/ModifiedFiles/queueManager");

    const pendingInteractions = new Map<string, (response: any) => void>();
    const modifiedFilesPromises: Array<Promise<void>> = [];
    const processedTokens = new Set<string>();

    const queueManager = new MessageQueueManager(
      this.state,
      workflow,
      modifiedFilesPromises,
      processedTokens,
      pendingInteractions,
    );

    this.state.currentQueueManager = queueManager;
    this.state.pendingInteractionsMap = pendingInteractions;
    this.state.resolvePendingInteraction = (messageId: string, response: any): boolean => {
      const resolver = pendingInteractions.get(messageId);
      if (!resolver) {
        this.logger.error("AgentOrchestrator: resolver not found", { messageId });
        return false;
      }
      pendingInteractions.delete(messageId);
      resolver(response);
      return true;
    };

    workflow.on("workflowMessage", async (msg) => {
      await processMessage(msg, this.state, queueManager);
    });

    try {
      this.logger.info("AgentOrchestrator: starting workflow via queue path");

      const queueDrained = new Promise<void>((resolve) => {
        queueManager.onDrain(resolve);
      });

      await agentClient.sendMessage("", uuidv4());
      await queueDrained;
      await Promise.all(modifiedFilesPromises);

      this.logger.info("AgentOrchestrator: workflow complete, queue drained", {
        queueLength: queueManager.getQueueLength(),
        pendingInteractions: pendingInteractions.size,
      });
    } catch (err) {
      this.handleError(err);
    } finally {
      queueManager.dispose();
      this.state.currentQueueManager = undefined;
      this.state.pendingInteractionsMap = undefined;
      this.state.resolvePendingInteraction = undefined;
      workflow.removeAllListeners();
      this.cleanup();
      if (disposeClient) {
        agentClient.dispose();
      }
    }
  }

  private initializeState(): void {
    const scope: Scope = { incidents: this.incidents };

    this.state.modifiedFiles.clear();

    this.state.mutate((draft) => {
      draft.isFetchingSolution = true;
      draft.solutionState = "started";
      draft.solutionScope = scope;
      draft.isProcessingQueuedMessages = false;
      draft.isWaitingForUserInteraction = false;
      draft.pendingBatchReview = [];
    });

    this.state.mutate((draft) => {
      draft.chatMessages = [];
    });

    this.state.mutate((draft) => {
      draft.activeDecorators = {};
    });
  }

  private handleStreamingChunk(
    content: string,
    contentType: AgentContentBlockType,
    resourceData?: StreamingResourceData,
  ): void {
    let text: string | undefined;

    switch (contentType) {
      case "text":
        text = content;
        break;
      case "thinking":
        text = content ? `> ${content}\n` : undefined;
        break;
      case "resource_link":
        if (resourceData?.uri) {
          text = `[Resource: ${resourceData.name || resourceData.uri}](${resourceData.uri})\n`;
        }
        break;
      case "resource":
        text = resourceData?.text;
        break;
      default:
        this.logger.warn("AgentOrchestrator: unhandled content type", { contentType });
        break;
    }

    if (!text) {
      return;
    }

    if (!this.lastTextMessageId) {
      this.lastTextMessageId = uuidv4();
      this.state.mutate((draft) => {
        draft.chatMessages.push({
          kind: ChatMessageType.String,
          messageToken: this.lastTextMessageId!,
          timestamp: new Date().toISOString(),
          value: { message: text! },
        });
      });
    } else {
      const tokenId = this.lastTextMessageId;
      this.state.mutate((draft) => {
        for (let i = draft.chatMessages.length - 1; i >= 0; i--) {
          const msg = draft.chatMessages[i];
          if (msg.messageToken === tokenId && msg.kind === ChatMessageType.String) {
            msg.value.message += text;
            msg.timestamp = new Date().toISOString();
            break;
          }
        }
      });
    }
  }

  private extractToolContext(args?: Record<string, unknown>): {
    filePath?: string;
    detail?: string;
  } {
    if (!args) {
      return {};
    }

    const rawPath = args.path ?? args.file_path ?? args.filename;
    const filePath = typeof rawPath === "string" ? rawPath : undefined;

    const rawCommand = args.command ?? args.cmd;
    const command = typeof rawCommand === "string" ? rawCommand : undefined;

    const rawQuery = args.query ?? args.search ?? args.pattern ?? args.regex;
    const query = typeof rawQuery === "string" ? rawQuery : undefined;

    const parts: string[] = [];
    if (filePath) {
      const basename = filePath.split("/").pop() || filePath;
      parts.push(basename);
    }
    if (command) {
      parts.push(command);
    }
    if (query) {
      const truncated = query.length > 60 ? `${query.substring(0, 57)}...` : query;
      parts.push(truncated);
    }

    return { filePath, detail: parts.length > 0 ? parts.join(" ") : undefined };
  }

  private handleToolCall(data: ToolCallData): void {
    const callId = data.callId ?? uuidv4();
    const toolName = data.name || "unnamed tool";
    const { filePath, detail } = this.extractToolContext(data.arguments);

    this.state.mutate((draft) => {
      draft.chatMessages.push({
        kind: ChatMessageType.Tool,
        messageToken: callId,
        timestamp: new Date().toISOString(),
        value: {
          toolName,
          toolStatus: data.status,
          toolResult: data.result,
          filePath,
          detail,
        } as ToolMessageValue,
      });
    });

    this.lastTextMessageId = null;
  }

  private markToolAsFileChangeRouted(callId: string): void {
    this.state.mutate((draft) => {
      for (let i = draft.chatMessages.length - 1; i >= 0; i--) {
        const msg = draft.chatMessages[i];
        if (msg.messageToken === callId && msg.kind === ChatMessageType.Tool) {
          (msg.value as ToolMessageValue).isFileChangeRouted = true;
          return;
        }
      }
    });
  }

  private handleToolCallUpdate(data: ToolCallData): void {
    const callId = data.callId;
    if (!callId) {
      return;
    }

    const toolName = data.name || "unnamed tool";

    this.state.mutate((draft) => {
      for (let i = draft.chatMessages.length - 1; i >= 0; i--) {
        const msg = draft.chatMessages[i];
        if (msg.messageToken === callId && msg.kind === ChatMessageType.Tool) {
          const prev = msg.value as ToolMessageValue;
          msg.value = {
            toolName: prev.toolName || toolName,
            toolStatus: data.status,
            toolResult: data.result,
            filePath: prev.filePath,
            detail: prev.detail,
          } as ToolMessageValue;
          msg.timestamp = new Date().toISOString();
          return;
        }
      }
      draft.chatMessages.push({
        kind: ChatMessageType.Tool,
        messageToken: callId,
        timestamp: new Date().toISOString(),
        value: {
          toolName,
          toolStatus: data.status,
          toolResult: data.result,
        } as ToolMessageValue,
      });
    });
  }

  private async handlePermissionRequest(
    agentClient: AgentClient,
    data: PermissionRequestData,
  ): Promise<void> {
    // Enrich the existing tool message with file context from the permission
    // request's rawInput (the initial tool_call may arrive without arguments
    // in approval mode).
    if (data.toolCallId && data.rawInput) {
      const { filePath, detail } = this.extractToolContext(
        data.rawInput as Record<string, unknown>,
      );
      if (filePath || detail) {
        this.state.mutate((draft) => {
          for (let i = draft.chatMessages.length - 1; i >= 0; i--) {
            const msg = draft.chatMessages[i];
            if (msg.messageToken === data.toolCallId && msg.kind === ChatMessageType.Tool) {
              const prev = msg.value as ToolMessageValue;
              if (!prev.filePath) {
                prev.filePath = filePath;
              }
              if (!prev.detail) {
                prev.detail = detail;
              }
              break;
            }
          }
        });
      }
    }

    this.lastTextMessageId = null;

    const fileTracker = this.state.featureClients.get("agentFileTracker") as
      | AgentFileTracker
      | undefined;

    await handlePermissionRequest({
      agentClient,
      data,
      workspaceRoot: this.state.data.workspaceRoot,
      fileTracker,
      mutate: (recipe) => this.state.mutate(recipe),
      pendingPermissions,
    });
  }

  private handleError(err: unknown): void {
    const errorMessage = err instanceof Error ? err.message : String(err);
    this.logger.error("AgentOrchestrator: error during workflow", { errorMessage });

    this.state.mutate((draft) => {
      draft.chatMessages.push({
        messageToken: `error-${Date.now()}`,
        kind: ChatMessageType.String,
        value: { message: `Error: ${errorMessage}` },
        timestamp: new Date().toISOString(),
      });
    });
  }

  private cleanup(): void {
    const pendingCount = this.state.data.pendingBatchReview?.length ?? 0;
    const isBatchReview = this.state.data.isBatchReviewMode === true;

    if (isBatchReview && pendingCount > 0) {
      this.logger.info("AgentOrchestrator: cleanup — batch review active", {
        pendingFiles: pendingCount,
        fileChangesRouted: this.fileChangesRouted,
      });
    } else {
      this.logger.info("AgentOrchestrator: cleanup complete", {
        fileChangesRouted: this.fileChangesRouted,
      });
    }

    // Finalize any tool messages still marked "running" — some backends
    // (e.g. OpenCode) don't send explicit tool completion events.
    this.state.mutate((draft) => {
      for (const msg of draft.chatMessages) {
        if (msg.kind === ChatMessageType.Tool) {
          const val = msg.value as ToolMessageValue;
          if (val.toolStatus === "running") {
            val.toolStatus = "succeeded";
          }
        }
      }
    });

    this.state.mutate((draft) => {
      draft.isFetchingSolution = false;
      draft.solutionState = "received";
      draft.isProcessingQueuedMessages = false;
    });

    this.state.mutate((draft) => {
      draft.isAnalyzing = false;
      draft.isAnalysisScheduled = false;
    });
  }
}
