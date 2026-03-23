import * as vscode from "vscode";
import type { FeatureModule, FeatureContext } from "../featureRegistry";
import { KonveyorGUIWebviewViewProvider } from "../../KonveyorGUIWebviewViewProvider";
import type { AgentClient } from "../../client/agentClient";
import { policyToGooseMode } from "./toolPermissionHandler";

export const agentFeatureModule: FeatureModule = {
  id: "agent",
  name: "Migration Assistant Chat",

  isEnabled(): boolean {
    return true;
  },

  async initialize(ctx: FeatureContext): Promise<vscode.Disposable> {
    const disposables: vscode.Disposable[] = [];

    ctx.mutate((draft) => {
      if (!draft.featureState) {
        draft.featureState = {};
      }
      draft.featureState.agentState = "stopped";
      draft.featureState.agentError = undefined;
    });

    const chatViewProvider = new KonveyorGUIWebviewViewProvider(ctx.extensionState, "chat");
    ctx.webviewProviders.set("chat", chatViewProvider);
    disposables.push(
      ctx.registerWebviewProvider(KonveyorGUIWebviewViewProvider.CHAT_VIEW_TYPE, chatViewProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );

    // Register message handlers
    const { agentMessageHandlers } = await import("./handlers");
    disposables.push(ctx.registerMessageHandlers(agentMessageHandlers));

    const { batchReviewHandlers } = await import("./batchReviewHandlers");
    disposables.push(ctx.registerMessageHandlers(batchReviewHandlers));

    // Start the Goose/OpenCode agent backend when agentMode is enabled.
    // The chat webview and batch review handlers above are always registered so that
    // getSolution (via DirectLLMClient) can render output regardless of this setting.
    const { getConfigAgentMode } = await import("../../utilities/configuration");
    if (getConfigAgentMode()) {
      try {
        const agentClient = await createAgentClient(ctx);
        const { initializeAgent } = await import("./init");
        const agentDisposable = await initializeAgent(ctx, agentClient);
        disposables.push(agentDisposable);
      } catch (err) {
        ctx.logger.error(`Failed to initialize agent: ${err}`);
      }
    } else {
      ctx.logger.info("Agent backend skipped (agentMode is false)");
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

  // Gather model environment variables and provider/model info
  let modelEnv: Record<string, string> = {};
  let kaiProvider: string | undefined;
  let kaiModel: string | undefined;

  try {
    const { paths } = await import("../../paths");
    const modelConfig = await parseModelConfig(paths().settingsYaml);
    modelEnv = (modelConfig.env ?? {}) as Record<string, string>;
    kaiProvider = modelConfig.config.provider;
    kaiModel = modelConfig.config.args?.model as string | undefined;
    ctx.logger.info(
      `Agent: passing auth env vars from provider-settings.yaml (provider: ${kaiProvider}, model: ${kaiModel})`,
    );
  } catch (err) {
    ctx.logger.warn(
      `Agent: could not read provider-settings.yaml for auth env vars: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const { loadAgentCredentials } = await import("../../utilities/agentCredentialStorage");
    const storedCreds = await loadAgentCredentials(ctx.extensionContext);
    if (storedCreds) {
      modelEnv = { ...modelEnv, ...storedCreds };
      ctx.logger.info(
        `Agent: merged ${Object.keys(storedCreds).length} credential(s) from SecretStorage`,
      );
    }
  } catch (err) {
    ctx.logger.warn(`Agent: could not load credentials from SecretStorage: ${err}`);
  }

  // Translate the generic tool permission policy to backend-specific config
  const toolPermissions = ctx.store.getState().toolPermissions;
  if (backend === "goose") {
    const gooseMode = policyToGooseMode(toolPermissions);
    modelEnv = { ...modelEnv, GOOSE_MODE: gooseMode };
  }

  if (backend === "opencode") {
    ctx.logger.info("Agent: using OpenCode backend");
    const { OpencodeAgentClient } = await import("../../client/opencodeClient");
    const opencodeModel =
      kaiProvider && kaiModel ? toOpencodeModelId(kaiProvider, kaiModel) : undefined;
    if (opencodeModel) {
      ctx.logger.info(`Agent: mapped to OpenCode model id "${opencodeModel}"`);
    }
    return new OpencodeAgentClient({
      workspaceDir,
      logger: ctx.logger,
      opencodeBinaryPath: getConfigOpencodeBinaryPath(),
      modelEnv,
      toolPermissions,
      opencodeModel,
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

/**
 * Map the extension's LangChain provider name + model arg to
 * OpenCode's `provider/model` identifier format.
 */
const KAI_TO_OPENCODE_PROVIDER: Record<string, string> = {
  ChatGoogleGenerativeAI: "google",
  ChatOpenAI: "openai",
  ChatBedrock: "amazon-bedrock",
  ChatDeepSeek: "deepseek",
  AzureChatOpenAI: "azure",
  ChatOllama: "ollama",
  ChatAnthropic: "anthropic",
};

function toOpencodeModelId(kaiProvider: string, modelName: string): string | undefined {
  const ocProvider = KAI_TO_OPENCODE_PROVIDER[kaiProvider];
  if (!ocProvider) {
    return undefined;
  }
  return `${ocProvider}/${modelName}`;
}
