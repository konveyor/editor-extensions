import * as vscode from "vscode";
import {
  GooseAgentState,
  GooseContentBlockType,
  GooseMessageTypes,
  ChatMessageType,
} from "@editor-extensions/shared";
import { v4 as uuidv4 } from "uuid";
import { parseModelConfig } from "../../modelProvider";
import type { FeatureContext } from "../featureRegistry";
import { GooseFileTracker } from "./gooseFileTracker";
import { routeFileChangeToBatchReview } from "./routeFileChange";
import type { PermissionRequestData } from "../../client/gooseClient";

type GooseClientType = InstanceType<typeof import("../../client/gooseClient").GooseClient>;

/**
 * Maps chat messageToken -> pending JSON-RPC request id so we can
 * respond to Goose when the user clicks a permission quick-response.
 */
export const pendingPermissions = new Map<
  string,
  { requestId: number; client: InstanceType<typeof import("../../client/gooseClient").GooseClient> }
>();

/**
 * Stores references to the default broadcast handlers so the
 * GooseOrchestrator can temporarily detach them (it writes directly
 * to chatMessages state and doesn't need the webview broadcast).
 */
let broadcastBinding: {
  client: GooseClientType;
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

export async function initializeGooseAgent(ctx: FeatureContext): Promise<vscode.Disposable> {
  const { getConfigGooseBinaryPath } = await import("../../utilities/configuration");
  const { GooseClient } = await import("../../client/gooseClient");
  const { McpBridgeServer } = await import("../../api/mcpBridgeServer");

  const disposables: vscode.Disposable[] = [];

  const fileTracker = new GooseFileTracker(ctx.logger);
  ctx.featureClients.set("gooseFileTracker", fileTracker);

  const mcpBridgeServer = new McpBridgeServer({
    store: ctx.store,
    logger: ctx.logger,
    runAnalysis: async () => {
      const analyzerClient = ctx.extensionState.analyzerClient;
      if (analyzerClient && (await analyzerClient.canAnalyzeInteractive())) {
        await analyzerClient.start();
      }
    },
  });

  const bridgePort = await mcpBridgeServer.start();
  ctx.featureClients.set("mcpBridgeServer", mcpBridgeServer);
  disposables.push({ dispose: () => mcpBridgeServer.dispose() });

  const { join } = await import("path");
  const mcpServerEntry = join(
    ctx.extensionContext.extensionPath,
    "..",
    "..",
    "mcp-server",
    "dist",
    "index.js",
  );

  let gooseModelEnv: Record<string, string> = {};

  try {
    const { paths } = await import("../../paths");
    const modelConfig = await parseModelConfig(paths().settingsYaml);
    gooseModelEnv = (modelConfig.env ?? {}) as Record<string, string>;
    ctx.logger.info(
      `Goose: passing auth env vars from provider-settings.yaml (provider: ${modelConfig.config.provider})`,
    );
  } catch (err) {
    ctx.logger.warn(
      `Goose: could not read provider-settings.yaml for auth env vars: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const { loadGooseCredentials } = await import("../../utilities/gooseCredentialStorage");
    const storedCreds = await loadGooseCredentials(ctx.extensionContext);
    if (storedCreds) {
      gooseModelEnv = { ...gooseModelEnv, ...storedCreds };
      ctx.logger.info(
        `Goose: merged ${Object.keys(storedCreds).length} credential(s) from SecretStorage`,
      );
    }
  } catch (err) {
    ctx.logger.warn(`Goose: could not load credentials from SecretStorage: ${err}`);
  }

  const gooseClient = new GooseClient({
    workspaceDir: ctx.store.getState().workspaceRoot,
    logger: ctx.logger,
    gooseBinaryPath: getConfigGooseBinaryPath(),
    mcpServers: [
      {
        name: "konveyor",
        type: "stdio",
        command: "node",
        args: [mcpServerEntry],
        env: [{ name: "KONVEYOR_BRIDGE_PORT", value: String(bridgePort) }],
      },
    ],
    modelEnv: gooseModelEnv,
  });

  gooseClient.on("stateChange", (agentState: string) => {
    ctx.logger.info(`Goose agent state: ${agentState}`);
    ctx.mutate((draft) => {
      if (!draft.featureState) {
        draft.featureState = {};
      }
      draft.featureState.gooseState = agentState as GooseAgentState;
    });
  });

  // --- Broadcast handlers (free-chat mode) ---
  // These forward streaming events to the webview. They are temporarily
  // detached by GooseOrchestrator (via suspendBroadcastHandlers) when it
  // takes over and writes directly to chatMessages state.

  const onStreamingChunk = (
    messageId: string,
    content: string,
    contentType: GooseContentBlockType,
    resourceData?: { uri?: string; name?: string; mimeType?: string; text?: string },
  ) => {
    for (const provider of ctx.webviewProviders.values()) {
      provider.sendMessageToWebview({
        type: GooseMessageTypes.GOOSE_CHAT_STREAMING_UPDATE,
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
        type: GooseMessageTypes.GOOSE_CHAT_STREAMING_UPDATE,
        messageId,
        content: "",
        done: true,
        stopReason,
        timestamp: new Date().toISOString(),
      });
    }
  };

  const sendToolCallToWebview = (
    messageId: string,
    data: { name: string; callId?: string; status: string; result?: string },
  ) => {
    for (const provider of ctx.webviewProviders.values()) {
      provider.sendMessageToWebview({
        type: GooseMessageTypes.GOOSE_TOOL_CALL,
        messageId,
        toolName: data.name,
        callId: data.callId,
        status: data.status,
        result: data.result,
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

  gooseClient.on("streamingChunk", onStreamingChunk);
  gooseClient.on("streamingComplete", onStreamingComplete);
  gooseClient.on("toolCall", onToolCallBroadcast);
  gooseClient.on("toolCallUpdate", onToolCallUpdateBroadcast);

  broadcastBinding = {
    client: gooseClient,
    handlers: {
      streamingChunk: onStreamingChunk,
      streamingComplete: onStreamingComplete,
      toolCallBroadcast: onToolCallBroadcast,
      toolCallUpdateBroadcast: onToolCallUpdateBroadcast,
    },
    suspended: false,
  };

  // Pre-cache file content before write tools execute so the post-scan
  // can detect changes made by Goose's built-in tools (which bypass MCP).
  // This listener is never suspended — caching must always happen.
  gooseClient.on("toolCall", (_messageId: string, data: any) => {
    if (data.arguments) {
      const workspaceRoot = ctx.store.getState().workspaceRoot;
      fileTracker.cacheFileBeforeWrite(data.name, data.arguments, workspaceRoot, data.callId);
    }
  });

  // When any tool completes successfully, check pending permission files
  // for changes and route them to batch review immediately.
  gooseClient.on("toolCallUpdate", (_messageId: string, data: any) => {
    if (data.status !== "succeeded") {
      return;
    }
    fileTracker.resolvePendingFileChanges().then(async (changes) => {
      for (const change of changes) {
        await routeFileChangeToBatchReview(
          ctx.extensionState,
          change.path,
          change.content,
          change.originalContent,
        );
        ctx.logger.info("Routed file change to batch review on tool completion", {
          path: change.path,
        });
      }
    });
  });

  gooseClient.on("error", (error: Error) => {
    ctx.logger.error(`Goose error: ${error.message}`);
    ctx.mutate((draft) => {
      if (!draft.featureState) {
        draft.featureState = {};
      }
      draft.featureState.gooseState = "error";
      draft.featureState.gooseError = error.message;
    });
  });

  // Permission requests from Goose (smart_approve mode).
  // Surfaces options as quick-response buttons in the chat so the user
  // can approve/reject tool calls before they execute.
  gooseClient.on("permissionRequest", (data: PermissionRequestData) => {
    if (broadcastBinding?.suspended) {
      return;
    }
    const messageToken = `perm-${uuidv4()}`;
    pendingPermissions.set(messageToken, {
      requestId: data.requestId,
      client: gooseClient,
    });

    // In smart_approve mode, tool arguments are in the permission request
    // (not in the tool_call event). Cache the file before the tool writes.
    if (data.rawInput) {
      const workspaceRoot = ctx.store.getState().workspaceRoot;
      fileTracker.cacheFileBeforeWrite(data.title, data.rawInput, workspaceRoot, data.toolCallId);
    }

    const kindLabels: Record<string, string> = {
      allow_once: "Allow",
      allow_always: "Always Allow",
      reject_once: "Reject",
      reject_always: "Always Reject",
    };

    ctx.mutate((draft) => {
      draft.chatMessages.push({
        kind: ChatMessageType.String,
        messageToken,
        timestamp: new Date().toISOString(),
        value: {
          message: `**Permission requested:** ${data.title}`,
        },
        quickResponses: data.options.map((opt) => ({
          id: opt.optionId,
          content: kindLabels[opt.kind] ?? opt.name,
        })),
      });
    });
  });

  ctx.featureClients.set("gooseClient", gooseClient);
  disposables.push({ dispose: () => gooseClient.dispose() });

  startGooseAgent(gooseClient, ctx);

  ctx.logger.info("Goose chat initialization complete");

  return vscode.Disposable.from(...disposables);
}

export function startGooseAgent(gooseClient: GooseClientType, ctx: FeatureContext): void {
  gooseClient
    .start()
    .then(async () => {
      try {
        const { readGooseConfig } = await import("../../gooseConfig");
        const { hasGooseCredentials } = await import("../../utilities/gooseCredentialStorage");
        const config = readGooseConfig();
        config.hasStoredCredentials = await hasGooseCredentials(ctx.extensionContext);
        const timestamp = new Date().toISOString();
        for (const provider of ctx.webviewProviders.values()) {
          provider.sendMessageToWebview({
            type: GooseMessageTypes.GOOSE_CONFIG_UPDATE,
            config,
            timestamp,
          });
        }
        ctx.logger.info(
          `Goose config sent to webview: provider=${config.provider}, model=${config.model}`,
        );
      } catch (configErr) {
        ctx.logger.warn(`Could not read goose config: ${configErr}`);
      }
    })
    .catch(async (err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      ctx.logger.error(`Failed to start Goose agent: ${errorMsg}`);

      if (errorMsg.includes("Goose binary not found")) {
        await promptGooseInstall(gooseClient, ctx);
      } else {
        vscode.window
          .showWarningMessage(`Goose agent failed to start: ${errorMsg}`, "View Logs")
          .then((action) => {
            if (action === "View Logs") {
              vscode.commands.executeCommand("workbench.action.output.toggleOutput");
            }
          });
      }
    });
}

async function promptGooseInstall(
  gooseClient: GooseClientType,
  ctx: FeatureContext,
): Promise<void> {
  const action = await vscode.window.showWarningMessage(
    "Goose CLI is not installed. Install it to use the Migration Assistant chat.",
    "Install Goose CLI",
    "Set Path Manually",
  );

  if (action === "Install Goose CLI") {
    const terminal = vscode.window.createTerminal({
      name: "Install Goose CLI",
    });
    terminal.show();

    const installCmd =
      process.platform === "win32"
        ? 'powershell -Command "irm https://github.com/block/goose/releases/download/stable/download_cli.ps1 | iex"'
        : "CONFIGURE=false curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash";

    terminal.sendText(installCmd);

    const disposable = vscode.window.onDidCloseTerminal(async (closedTerminal) => {
      if (closedTerminal === terminal) {
        disposable.dispose();
        ctx.logger.info("Goose install terminal closed, retrying agent start");
        startGooseAgent(gooseClient, ctx);
      }
    });
    ctx.extensionContext.subscriptions.push(disposable);
  } else if (action === "Set Path Manually") {
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "konveyor-core.experimentalChat.gooseBinaryPath",
    );
  }
}
