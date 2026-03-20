import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import {
  EnhancedIncident,
  Scope,
  ChatMessageType,
  GooseContentBlockType,
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
import type { GooseFileTracker } from "./gooseFileTracker";
import { routeFileChangeToBatchReview } from "./routeFileChange";
import { buildMigrationPrompt } from "./goosePromptBuilder";
import { suspendBroadcastHandlers, resumeBroadcastHandlers, pendingPermissions } from "./gooseInit";
import { handlePermissionWithPolicy } from "./toolPermissionHandler";
import { executeExtensionCommand } from "../../commands";
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

  constructor(
    private readonly state: ExtensionState,
    private readonly logger: Logger,
    private readonly incidents: EnhancedIncident[],
  ) {}

  async run(): Promise<void> {
    const agentClient = this.state.featureClients.get("agentClient") as AgentClient | undefined;
    if (!agentClient || agentClient.getState() !== "running") {
      vscode.window.showErrorMessage(
        "Agent is not running. Please ensure the agent backend is installed and has started.",
      );
      return;
    }

    if (this.state.data.isFetchingSolution) {
      vscode.window.showWarningMessage("Solution already being fetched");
      return;
    }

    const profileName = this.incidents[0]?.activeProfileName;
    if (!profileName) {
      vscode.window.showErrorMessage("No profile name found in incidents");
      return;
    }

    const fileTracker = this.state.featureClients.get("gooseFileTracker") as
      | GooseFileTracker
      | undefined;

    this.logger.info("AgentOrchestrator: starting", {
      incidentsCount: this.incidents.length,
      profileName,
    });

    await executeExtensionCommand("showChatPanel");
    this.initializeState();

    suspendBroadcastHandlers();

    const onChunk = (
      _msgId: string,
      content: string,
      contentType: GooseContentBlockType,
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
            await routeFileChangeToBatchReview(
              this.state,
              change.path,
              change.content,
              change.originalContent,
            );
            this.logger.info("AgentOrchestrator: routed file change on tool completion", {
              path: change.path,
            });
          }
          if (changes.length > 0 && data.callId) {
            this.markToolAsFileChangeRouted(data.callId);
          }
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
      const sessionId = await agentClient.createSession();
      this.logger.info("AgentOrchestrator: created new session for getSolution", { sessionId });

      this.state.mutate((draft) => {
        if (draft.solutionScope) {
          draft.solutionScope.gooseSessionId = sessionId;
        }
      });

      if (fileTracker) {
        fileTracker.clear();
        if (this.incidents.length > 0) {
          await fileTracker.cacheIncidentFiles(this.incidents, this.state.data.workspaceRoot);
        }
      }

      const programmingLanguage =
        this.incidents.length > 0 ? getProgrammingLanguageFromUri(this.incidents[0].uri) : "Java";

      const prompt = await buildMigrationPrompt(
        {
          incidents: this.incidents,
          migrationHint: profileName,
          programmingLanguage,
          enableAgentMode: true,
        },
        this.state.data.workspaceRoot,
      );

      const requestId = uuidv4();
      await agentClient.sendMessage(prompt, requestId);

      if (fileTracker) {
        const missedChanges = await fileTracker.scanForMissedChanges();
        for (const change of missedChanges) {
          await routeFileChangeToBatchReview(
            this.state,
            change.path,
            change.content,
            change.originalContent,
          );
        }
        if (missedChanges.length > 0) {
          this.logger.info(
            `AgentOrchestrator: routed ${missedChanges.length} post-scan file(s) to batch review`,
          );
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
    contentType: GooseContentBlockType,
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

  private handlePermissionRequest(agentClient: AgentClient, data: PermissionRequestData): void {
    const fileTracker = this.state.featureClients.get("gooseFileTracker") as
      | GooseFileTracker
      | undefined;

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

    handlePermissionWithPolicy({
      agentClient,
      data,
      policy: this.state.data.toolPermissions,
      workspaceRoot: this.state.data.workspaceRoot,
      fileTracker,
      mutate: this.state.mutate.bind(this.state),
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
    this.logger.info("AgentOrchestrator: cleanup — batch review will remain active");

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
