import * as vscode from "vscode";
import type { FeatureModule, FeatureContext } from "../featureRegistry";
import { KonveyorGUIWebviewViewProvider } from "../../KonveyorGUIWebviewViewProvider";
import type { AgentClient } from "../../client/agentClient";

export const gooseFeatureModule: FeatureModule = {
  id: "goose",
  name: "Migration Assistant Chat",

  isEnabled(): boolean {
    const { getConfigExperimentalChatEnabled } = require("../../utilities/configuration");
    return getConfigExperimentalChatEnabled();
  },

  async initialize(ctx: FeatureContext): Promise<vscode.Disposable> {
    const disposables: vscode.Disposable[] = [];

    ctx.mutate((draft) => {
      if (!draft.featureState) {
        draft.featureState = {};
      }
      draft.featureState.gooseState = "stopped";
      draft.featureState.gooseError = undefined;
    });

    const chatViewProvider = new KonveyorGUIWebviewViewProvider(ctx.extensionState, "chat");
    ctx.webviewProviders.set("chat", chatViewProvider);
    disposables.push(
      ctx.registerWebviewProvider(KonveyorGUIWebviewViewProvider.CHAT_VIEW_TYPE, chatViewProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );

    // Register message handlers
    const { gooseMessageHandlers } = await import("./gooseHandlers");
    disposables.push(ctx.registerMessageHandlers(gooseMessageHandlers));

    // Create the agent client based on the configured backend
    try {
      const agentClient = await createAgentClient(ctx);
      const { initializeAgent } = await import("./gooseInit");
      const agentDisposable = await initializeAgent(ctx, agentClient);
      disposables.push(agentDisposable);
    } catch (err) {
      ctx.logger.error(`Failed to initialize agent: ${err}`);
    }

    ctx.logger.info("Agent feature module initialized");

    return vscode.Disposable.from(...disposables);
  },
};

/**
 * Create the appropriate AgentClient based on the configured backend setting.
 */
async function createAgentClient(ctx: FeatureContext): Promise<AgentClient> {
  const { getConfigAgentBackend, getConfigGooseBinaryPath, getConfigOpencodeBinaryPath } =
    await import("../../utilities/configuration");
  const { parseModelConfig } = await import("../../modelProvider");
  const { join } = await import("path");

  const backend = getConfigAgentBackend();
  const workspaceDir = ctx.store.getState().workspaceRoot;

  // Build MCP server config for the Konveyor MCP bridge
  const mcpServerEntry = join(
    ctx.extensionContext.extensionPath,
    "..",
    "..",
    "mcp-server",
    "dist",
    "index.js",
  );

  // Gather model environment variables
  let modelEnv: Record<string, string> = {};

  try {
    const { paths } = await import("../../paths");
    const modelConfig = await parseModelConfig(paths().settingsYaml);
    modelEnv = (modelConfig.env ?? {}) as Record<string, string>;
    ctx.logger.info(
      `Agent: passing auth env vars from provider-settings.yaml (provider: ${modelConfig.config.provider})`,
    );
  } catch (err) {
    ctx.logger.warn(
      `Agent: could not read provider-settings.yaml for auth env vars: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const { loadGooseCredentials } = await import("../../utilities/gooseCredentialStorage");
    const storedCreds = await loadGooseCredentials(ctx.extensionContext);
    if (storedCreds) {
      modelEnv = { ...modelEnv, ...storedCreds };
      ctx.logger.info(
        `Agent: merged ${Object.keys(storedCreds).length} credential(s) from SecretStorage`,
      );
    }
  } catch (err) {
    ctx.logger.warn(`Agent: could not load credentials from SecretStorage: ${err}`);
  }

  // MCP server config will be set up after bridge port is available
  // The initializeAgent function handles MCP bridge setup internally

  if (backend === "opencode") {
    ctx.logger.info("Agent: using OpenCode backend");
    const { OpencodeAgentClient } = await import("../../client/opencodeClient");
    return new OpencodeAgentClient({
      workspaceDir,
      logger: ctx.logger,
      opencodeBinaryPath: getConfigOpencodeBinaryPath(),
      modelEnv,
    });
  }

  ctx.logger.info("Agent: using Goose backend");
  const { GooseClient } = await import("../../client/gooseClient");
  return new GooseClient({
    workspaceDir,
    logger: ctx.logger,
    gooseBinaryPath: getConfigGooseBinaryPath(),
    modelEnv,
  });
}
