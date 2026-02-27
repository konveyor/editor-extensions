import * as vscode from "vscode";
import {
  GooseAgentState,
  GooseContentBlockType,
  GooseMessageTypes,
} from "@editor-extensions/shared";
import { parseModelConfig } from "../../modelProvider";
import type { FeatureContext } from "../featureRegistry";

type GooseClientType = InstanceType<typeof import("../../client/gooseClient").GooseClient>;

export async function initializeGooseAgent(ctx: FeatureContext): Promise<vscode.Disposable> {
  const { getConfigGooseBinaryPath } = await import("../../utilities/configuration");
  const { GooseClient } = await import("../../client/gooseClient");
  const { McpBridgeServer } = await import("../../api/mcpBridgeServer");

  const disposables: vscode.Disposable[] = [];

  const mcpBridgeServer = new McpBridgeServer({
    store: ctx.store,
    logger: ctx.logger,
    runAnalysis: async () => {
      const { AnalyzerClient } = await import("../../client/analyzerClient");
      const analyzerClient = ctx.featureClients.get("_analyzerClient") as any;
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

  gooseClient.on(
    "streamingChunk",
    (
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
    },
  );

  gooseClient.on("streamingComplete", (messageId: string, stopReason: string) => {
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
  });

  const broadcastToolCall = (
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

  gooseClient.on("toolCall", (messageId: string, data: any) => {
    broadcastToolCall(messageId, data);
  });

  gooseClient.on("toolCallUpdate", (messageId: string, data: any) => {
    broadcastToolCall(messageId, data);
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
