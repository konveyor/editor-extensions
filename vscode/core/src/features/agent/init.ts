import * as vscode from "vscode";
import { AgentState, AgentContentBlockType, AgentMessageTypes } from "@editor-extensions/shared";
import type { FeatureContext } from "../featureRegistry";
import { AgentFileTracker } from "./fileTracker";
import type { AgentClient, PermissionRequestData } from "../../client/agentClient";
import { routeFileChange } from "./fileChangeRouter";
import { handlePermissionRequest, type PendingPermission } from "./toolPermissionHandler";

export { type PendingPermission } from "./toolPermissionHandler";
export const pendingPermissions = new Map<string, PendingPermission>();

/**
 * Stores references to the default broadcast handlers so the
 * AgentOrchestrator can temporarily detach them (it writes directly
 * to chatMessages state and doesn't need the webview broadcast).
 */
let broadcastBinding: {
  client: AgentClient;
  handlers: {
    streamingChunk: (...args: any[]) => void;
    streamingComplete: (...args: any[]) => void;
    toolCallBroadcast: (...args: any[]) => void;
    toolCallUpdateBroadcast: (...args: any[]) => void;
  };
  suspended: boolean;
} | null = null;

export function suspendBroadcastHandlers(): void {
  if (!broadcastBinding || broadcastBinding.suspended) {
    return;
  }
  broadcastBinding.suspended = true;
  const { client, handlers } = broadcastBinding;
  client.removeListener("streamingChunk", handlers.streamingChunk);
  client.removeListener("streamingComplete", handlers.streamingComplete);
  client.removeListener("toolCall", handlers.toolCallBroadcast);
  client.removeListener("toolCallUpdate", handlers.toolCallUpdateBroadcast);
}

export function resumeBroadcastHandlers(): void {
  if (!broadcastBinding || !broadcastBinding.suspended) {
    return;
  }
  broadcastBinding.suspended = false;
  const { client, handlers } = broadcastBinding;
  client.on("streamingChunk", handlers.streamingChunk);
  client.on("streamingComplete", handlers.streamingComplete);
  client.on("toolCall", handlers.toolCallBroadcast);
  client.on("toolCallUpdate", handlers.toolCallUpdateBroadcast);
}

/**
 * Initialize the agent and wire up all event listeners.
 *
 * Accepts an AgentClient (GooseClient or OpencodeAgentClient) created
 * by the feature module based on the configured backend.
 */
export async function initializeAgent(
  ctx: FeatureContext,
  agentClient: AgentClient,
): Promise<vscode.Disposable> {
  const { McpBridgeServer } = await import("../../api/mcpBridgeServer");

  const disposables: vscode.Disposable[] = [];

  const fileTracker = new AgentFileTracker(ctx.logger);
  ctx.featureClients.set("agentFileTracker", fileTracker);

  const mcpBridgeServer = new McpBridgeServer({
    store: ctx.store,
    logger: ctx.logger,
    runAnalysis: async () => {
      const analyzerClient = ctx.extensionState.analyzerClient;
      if (!analyzerClient) {
        ctx.logger.warn("MCP run_analysis: analyzerClient not available");
        return;
      }
      if (analyzerClient.serverState !== "running") {
        if (!(await analyzerClient.canAnalyzeInteractive())) {
          return;
        }
        await analyzerClient.start();
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            if (analyzerClient.serverState === "running") {
              clearInterval(checkInterval);
              resolve();
            } else if (
              analyzerClient.serverState === "startFailed" ||
              analyzerClient.serverState === "stopped"
            ) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 500);
        });
      }
      if (analyzerClient.serverState === "running") {
        await analyzerClient.runAnalysis();

        const storeData = ctx.store.getState();
        const incidentCount = storeData.enhancedIncidents?.length ?? 0;
        const ruleSetCount = storeData.ruleSets?.length ?? 0;

        if (incidentCount > 0) {
          const sysId = `system-analysis-${Date.now()}`;
          const summary = `Analysis complete: ${incidentCount} incident${incidentCount !== 1 ? "s" : ""} found across ${ruleSetCount} rule set${ruleSetCount !== 1 ? "s" : ""}.`;
          for (const provider of ctx.webviewProviders.values()) {
            provider.sendMessageToWebview({
              type: AgentMessageTypes.AGENT_CHAT_STREAMING_UPDATE,
              messageId: sysId,
              content: summary,
              done: false,
              timestamp: new Date().toISOString(),
            });
            provider.sendMessageToWebview({
              type: AgentMessageTypes.AGENT_CHAT_STREAMING_UPDATE,
              messageId: sysId,
              content: "",
              done: true,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } else {
        ctx.logger.warn(
          `MCP run_analysis: analyzer not running (state: ${analyzerClient.serverState})`,
        );
      }
    },
  });

  const bridgePort = await mcpBridgeServer.start();
  ctx.featureClients.set("mcpBridgeServer", mcpBridgeServer);
  disposables.push({ dispose: () => mcpBridgeServer.dispose() });

  // Configure MCP servers on the agent client before starting
  const { join } = await import("path");
  const mcpServerEntry = join(
    ctx.extensionContext.extensionPath,
    "..",
    "..",
    "mcp-server",
    "dist",
    "index.js",
  );
  agentClient.setMcpServers([
    {
      name: "konveyor",
      type: "stdio",
      command: "node",
      args: [mcpServerEntry],
      env: [
        { name: "KONVEYOR_BRIDGE_PORT", value: String(bridgePort) },
        { name: "KONVEYOR_BRIDGE_TOKEN", value: mcpBridgeServer.getBearerToken() },
      ],
    },
  ]);

  ctx.featureClients.set("agentClient", agentClient);
  disposables.push({ dispose: () => agentClient.dispose() });

  agentClient.on("stateChange", (agentState: string) => {
    ctx.logger.info(`Agent state: ${agentState}`);
    ctx.mutate((draft) => {
      if (!draft.featureState) {
        draft.featureState = {};
      }
      draft.featureState.agentState = agentState as AgentState;
    });
  });

  // --- Broadcast handlers (free-chat mode) ---
  // These forward streaming events to the webview. They are temporarily
  // detached by AgentOrchestrator (via suspendBroadcastHandlers) when it
  // takes over and writes directly to chatMessages state.

  const onStreamingChunk = (
    messageId: string,
    content: string,
    contentType: AgentContentBlockType,
    resourceData?: { uri?: string; name?: string; mimeType?: string; text?: string },
  ) => {
    for (const provider of ctx.webviewProviders.values()) {
      provider.sendMessageToWebview({
        type: AgentMessageTypes.AGENT_CHAT_STREAMING_UPDATE,
        messageId,
        content,
        done: false,
        timestamp: new Date().toISOString(),
        contentType,
        resourceUri: resourceData?.uri,
        resourceName: resourceData?.name,
        resourceMimeType: resourceData?.mimeType,
        resourceContent: resourceData?.text,
      });
    }
  };

  const onStreamingComplete = (messageId: string, stopReason: string) => {
    for (const provider of ctx.webviewProviders.values()) {
      provider.sendMessageToWebview({
        type: AgentMessageTypes.AGENT_CHAT_STREAMING_UPDATE,
        messageId,
        content: "",
        done: true,
        stopReason,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const sendToolCallToWebview = (
    _responseMessageId: string,
    data: {
      name: string;
      callId?: string;
      status: string;
      result?: string;
      arguments?: Record<string, unknown>;
    },
  ) => {
    const toolMessageId = data.callId
      ? `tool-${data.callId}`
      : `tool-${_responseMessageId}-${Date.now()}`;
    for (const provider of ctx.webviewProviders.values()) {
      provider.sendMessageToWebview({
        type: AgentMessageTypes.AGENT_TOOL_CALL,
        messageId: toolMessageId,
        toolName: data.name,
        callId: data.callId,
        status: data.status,
        result: data.result,
        arguments: data.arguments,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const onToolCallBroadcast = (messageId: string, data: any) => {
    sendToolCallToWebview(messageId, data);
  };

  const onToolCallUpdateBroadcast = (messageId: string, data: any) => {
    sendToolCallToWebview(messageId, data);
  };

  agentClient.on("streamingChunk", onStreamingChunk);
  agentClient.on("streamingComplete", onStreamingComplete);
  agentClient.on("toolCall", onToolCallBroadcast);
  agentClient.on("toolCallUpdate", onToolCallUpdateBroadcast);

  broadcastBinding = {
    client: agentClient,
    handlers: {
      streamingChunk: onStreamingChunk,
      streamingComplete: onStreamingComplete,
      toolCallBroadcast: onToolCallBroadcast,
      toolCallUpdateBroadcast: onToolCallUpdateBroadcast,
    },
    suspended: false,
  };

  // Pre-cache file content before write tools execute so the post-scan
  // can detect changes made by the agent's built-in tools (which bypass MCP).
  // This listener is never suspended — caching must always happen.
  agentClient.on("toolCall", (_messageId: string, data: any) => {
    if (data.arguments) {
      const workspaceRoot = ctx.store.getState().workspaceRoot;
      fileTracker.cacheFileBeforeWrite(data.name, data.arguments, workspaceRoot, data.callId);
    }
  });

  // When any tool completes successfully, check for file changes
  // and show them in the chat as condensed change blocks.
  agentClient.on("toolCallUpdate", (_messageId: string, data: any) => {
    if (data.status !== "succeeded") {
      return;
    }
    fileTracker
      .resolvePendingFileChanges()
      .then(async (changes) => {
        for (const change of changes) {
          await routeFileChange(
            ctx.extensionState,
            change.path,
            change.content,
            change.originalContent,
          );
          ctx.logger.info("File change routed", { path: change.path });
        }
      })
      .catch((err) => {
        ctx.logger.error("Failed to resolve pending file changes", { error: err });
      });
  });

  agentClient.on("error", (error: Error) => {
    ctx.logger.error(`Agent error: ${error.message}`);
    ctx.mutate((draft) => {
      if (!draft.featureState) {
        draft.featureState = {};
      }
      draft.featureState.agentState = "error";
      draft.featureState.agentError = error.message;
    });
  });

  // Permission requests from the agent.
  // Uses the generic tool permission policy to decide auto-approve/deny/ask.
  // All paths go through the same rendering: label + preview, with different status.
  agentClient.on("permissionRequest", async (data: PermissionRequestData) => {
    if (broadcastBinding?.suspended) {
      return;
    }

    handlePermissionRequest({
      agentClient,
      data,
      workspaceRoot: ctx.store.getState().workspaceRoot,
      fileTracker,
      mutate: ctx.mutate,
      pendingPermissions,
    });
  });

  startAgent(agentClient, ctx);

  ctx.logger.info("Agent initialization complete");

  return vscode.Disposable.from(...disposables);
}

export function startAgent(agentClient: AgentClient, ctx: FeatureContext): void {
  agentClient
    .start()
    .then(async () => {
      try {
        const { readAgentConfig } = await import("../../agentConfigReader");
        const { hasAgentCredentials } = await import("../../utilities/agentCredentialStorage");
        const config = readAgentConfig();
        config.hasStoredCredentials = await hasAgentCredentials(ctx.extensionContext);
        config.agentMode = (ctx.store.getState().featureState?.agentMode as boolean) ?? true;
        const timestamp = new Date().toISOString();
        for (const provider of ctx.webviewProviders.values()) {
          provider.sendMessageToWebview({
            type: AgentMessageTypes.AGENT_CONFIG_UPDATE,
            config,
            timestamp,
          });
        }
        ctx.logger.info(
          `Agent config sent to webview: provider=${config.provider}, model=${config.model}`,
        );
      } catch (configErr) {
        ctx.logger.warn(`Could not read agent config: ${configErr}`);
      }
    })
    .catch(async (err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      ctx.logger.error(`Failed to start agent: ${errorMsg}`);

      if (errorMsg.includes("binary not found") || errorMsg.includes("not found")) {
        await promptAgentInstall(agentClient, ctx);
      } else {
        vscode.window
          .showWarningMessage(`Agent failed to start: ${errorMsg}`, "View Logs")
          .then((action) => {
            if (action === "View Logs") {
              vscode.commands.executeCommand("workbench.action.output.toggleOutput");
            }
          });
      }
    });
}

async function promptAgentInstall(agentClient: AgentClient, ctx: FeatureContext): Promise<void> {
  const { getConfigAgentBackend } = await import("../../utilities/configuration");
  const backend = getConfigAgentBackend();

  const action = await vscode.window.showWarningMessage(
    `${backend === "goose" ? "Goose" : "OpenCode"} CLI is not installed. Install it to use the Migration Assistant chat.`,
    `Install ${backend === "goose" ? "Goose" : "OpenCode"} CLI`,
    "Set Path Manually",
  );

  if (action?.startsWith("Install")) {
    const terminal = vscode.window.createTerminal({
      name: `Install ${backend === "goose" ? "Goose" : "OpenCode"} CLI`,
    });
    terminal.show();

    let installCmd: string;
    if (backend === "opencode") {
      installCmd =
        process.platform === "win32" ? "npm install -g opencode-ai" : "npm install -g opencode-ai";
    } else {
      installCmd =
        process.platform === "win32"
          ? 'powershell -Command "irm https://github.com/block/goose/releases/download/stable/download_cli.ps1 | iex"'
          : "CONFIGURE=false curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash";
    }

    terminal.sendText(installCmd);

    const disposable = vscode.window.onDidCloseTerminal(async (closedTerminal) => {
      if (closedTerminal === terminal) {
        disposable.dispose();
        ctx.logger.info("Install terminal closed, retrying agent start");
        startAgent(agentClient, ctx);
      }
    });
    ctx.extensionContext.subscriptions.push(disposable);
  } else if (action === "Set Path Manually") {
    const settingsKey =
      backend === "opencode"
        ? "konveyor-core.experimentalChat.opencodeBinaryPath"
        : "konveyor-core.experimentalChat.gooseBinaryPath";
    await vscode.commands.executeCommand("workbench.action.openSettings", settingsKey);
  }
}
