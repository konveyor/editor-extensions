import * as vscode from "vscode";
import type { FeatureModule, FeatureContext } from "../featureRegistry";
import { KonveyorGUIWebviewViewProvider } from "../../KonveyorGUIWebviewViewProvider";
import type { AcpClient } from "../../client/acpClient";

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

    // Start the ACP agent backend when agentMode is enabled.
    // The chat webview and batch review handlers above are always registered so that
    // getSolution (via DirectLLMClient) can render output regardless of this setting.
    const { getConfigAgentMode } = await import("../../utilities/configuration");
    if (getConfigAgentMode()) {
      try {
        const agentClient = await createAcpClient(ctx);
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
 * Backend-specific config for each ACP-compatible agent.
 */
interface BackendConfig {
  binaryName: string;
  binaryArgs: string[];
  minimumVersion: string;
}

const BACKEND_CONFIGS: Record<string, BackendConfig> = {
  goose: { binaryName: "goose", binaryArgs: ["acp"], minimumVersion: "1.16.0" },
  opencode: { binaryName: "opencode", binaryArgs: ["acp"], minimumVersion: "0.1.0" },
};

/**
 * Create an AcpClient for the configured backend.
 *
 * Both Goose and OpenCode implement ACP and are launched the same way:
 * `<binary> acp` over JSON-RPC 2.0 / stdio.
 */
async function createAcpClient(ctx: FeatureContext): Promise<AcpClient> {
  const { getConfigAgentBackend, getConfigAgentBinaryPath } =
    await import("../../utilities/configuration");
  const { parseModelConfig } = await import("../../modelProvider");
  const { AcpClient } = await import("../../client/acpClient");

  const backend = getConfigAgentBackend();
  const workspaceDir = ctx.store.getState().workspaceRoot;

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

  const backendConfig = BACKEND_CONFIGS[backend] ?? {
    binaryName: backend,
    binaryArgs: ["acp"],
    minimumVersion: "0.1.0",
  };
  ctx.logger.info(`Agent: using ${backendConfig.binaryName} backend (ACP)`);

  return new AcpClient({
    workspaceDir,
    logger: ctx.logger,
    binaryPath: getConfigAgentBinaryPath(),
    binaryName: backendConfig.binaryName,
    binaryArgs: backendConfig.binaryArgs,
    minimumVersion: backendConfig.minimumVersion,
    modelEnv,
  });
}
