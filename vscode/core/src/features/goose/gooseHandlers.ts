import * as vscode from "vscode";
import {
  GOOSE_SEND_MESSAGE,
  GOOSE_START_AGENT,
  GOOSE_STOP_AGENT,
  GOOSE_UPDATE_CONFIG,
  GOOSE_TOGGLE_VIEW,
  GOOSE_INSTALL_CLI,
  GOOSE_OPEN_SETTINGS,
  GOOSE_PERMISSION_RESPONSE,
  SET_EDIT_APPROVAL_MODE,
  GooseMessageTypes,
} from "@editor-extensions/shared";
import { pendingPermissions } from "./gooseInit";
import { editApprovalModeToGooseMode } from "./editApprovalHandler";
import type { ExtensionState } from "../../extensionState";
import type winston from "winston";
import type { AgentClient } from "../../client/agentClient";

function getAgentClient(state: ExtensionState): AgentClient | undefined {
  return state.featureClients.get("agentClient") as AgentClient | undefined;
}

export const gooseMessageHandlers: Record<
  string,
  (payload: any, state: ExtensionState, logger: winston.Logger) => void | Promise<void>
> = {
  [GOOSE_SEND_MESSAGE]: async (
    { content, messageId }: { content: string; messageId: string },
    state,
    logger,
  ) => {
    const agentClient = getAgentClient(state);
    if (!agentClient) {
      logger.warn("GOOSE_SEND_MESSAGE: Agent client not available");
      return;
    }

    try {
      if (agentClient.isPromptActive()) {
        logger.info("GOOSE_SEND_MESSAGE: cancelling active prompt for cancel-and-send");
        agentClient.cancelGeneration();
      }
      await agentClient.sendMessage(content, messageId);
    } catch (err) {
      logger.error("GOOSE_SEND_MESSAGE failed:", err);
    }
  },

  [GOOSE_START_AGENT]: async (_payload, state, logger) => {
    const agentClient = getAgentClient(state);
    if (!agentClient) {
      logger.warn("GOOSE_START_AGENT: Agent client not available");
      return;
    }

    try {
      await agentClient.start();
    } catch (err) {
      logger.error("GOOSE_START_AGENT failed:", err);
    }
  },

  [GOOSE_STOP_AGENT]: async (_payload, state, logger) => {
    const agentClient = getAgentClient(state);
    if (!agentClient) {
      logger.warn("GOOSE_STOP_AGENT: Agent client not available");
      return;
    }

    try {
      await agentClient.stop();
    } catch (err) {
      logger.error("GOOSE_STOP_AGENT failed:", err);
    }
  },

  [GOOSE_UPDATE_CONFIG]: async (
    payload: {
      provider: string;
      model: string;
      extensions: Array<{ id: string; enabled: boolean }>;
      credentials?: Record<string, string>;
    },
    state,
    logger,
  ) => {
    try {
      const { writeGooseConfig, readGooseConfig } = await import("../../gooseConfig");
      const { saveGooseCredentials, hasGooseCredentials } =
        await import("../../utilities/gooseCredentialStorage");

      writeGooseConfig({
        provider: payload.provider,
        model: payload.model,
        extensions: payload.extensions,
      });
      logger.info(`Agent config updated: provider=${payload.provider}, model=${payload.model}`);

      if (payload.credentials && Object.keys(payload.credentials).length > 0) {
        const { loadGooseCredentials } = await import("../../utilities/gooseCredentialStorage");
        const existing = (await loadGooseCredentials(state.extensionContext)) ?? {};
        const merged = { ...existing, ...payload.credentials };
        const cleaned: Record<string, string> = {};
        for (const [k, v] of Object.entries(merged)) {
          if (v) {
            cleaned[k] = v;
          }
        }
        await saveGooseCredentials(state.extensionContext, cleaned);
        logger.info(`Agent credentials saved (${Object.keys(cleaned).length} keys)`);

        const agentClient = getAgentClient(state);
        if (agentClient) {
          agentClient.updateModelEnv(cleaned);
        }
      }

      const agentClient = getAgentClient(state);
      if (agentClient) {
        await agentClient.stop();
        await agentClient.start();
      }

      const updatedConfig = readGooseConfig();
      updatedConfig.hasStoredCredentials = await hasGooseCredentials(state.extensionContext);
      const timestamp = new Date().toISOString();
      for (const provider of state.webviewProviders.values()) {
        provider.sendMessageToWebview({
          type: GooseMessageTypes.GOOSE_CONFIG_UPDATE,
          config: updatedConfig,
          timestamp,
        });
      }
    } catch (err) {
      logger.error("GOOSE_UPDATE_CONFIG failed:", err);
      vscode.window.showErrorMessage(
        `Failed to update configuration: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  [GOOSE_TOGGLE_VIEW]: async (_payload, state, logger) => {
    try {
      const chatProvider = state.webviewProviders?.get("chat");
      if (!chatProvider) {
        logger.warn("Chat provider not found for GOOSE_TOGGLE_VIEW");
        return;
      }

      if (chatProvider.hasPanel) {
        chatProvider.closePanel();
      } else {
        chatProvider.showWebviewPanel();
        await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
      }
    } catch (err) {
      logger.error("GOOSE_TOGGLE_VIEW failed:", err);
    }
  },

  [GOOSE_INSTALL_CLI]: async (_payload, state, logger) => {
    try {
      const terminal = vscode.window.createTerminal({ name: "Install Agent CLI" });
      terminal.show();

      const { getConfigAgentBackend } = await import("../../utilities/configuration");
      const backend = getConfigAgentBackend();

      let installCmd: string;
      if (backend === "opencode") {
        installCmd = "npm install -g opencode-ai";
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
          logger.info("Install terminal closed, retrying agent start");
          const agentClient = getAgentClient(state);
          if (agentClient) {
            try {
              await agentClient.start();
            } catch (err) {
              logger.error("Failed to start agent after install:", err);
            }
          }
        }
      });
    } catch (err) {
      logger.error("GOOSE_INSTALL_CLI failed:", err);
      vscode.window.showErrorMessage("Failed to open install terminal.");
    }
  },

  [GOOSE_OPEN_SETTINGS]: async () => {
    const { getConfigAgentBackend } = await import("../../utilities/configuration");
    const backend = getConfigAgentBackend();
    const settingsKey =
      backend === "opencode"
        ? "konveyor-core.experimentalChat.opencodeBinaryPath"
        : "konveyor-core.experimentalChat.gooseBinaryPath";
    await vscode.commands.executeCommand("workbench.action.openSettings", settingsKey);
  },

  GOOSE_WEBVIEW_READY: async (_payload, state, _logger) => {
    try {
      const { readGooseConfig } = await import("../../gooseConfig");
      const { hasGooseCredentials } = await import("../../utilities/gooseCredentialStorage");
      const config = readGooseConfig();
      config.hasStoredCredentials = await hasGooseCredentials(state.extensionContext);
      const timestamp = new Date().toISOString();

      const gooseState = (state.store.getState().featureState?.gooseState as string) ?? "stopped";
      const gooseError = state.store.getState().featureState?.gooseError as string | undefined;

      state.webviewProviders.forEach((provider) => {
        provider.sendMessageToWebview({
          type: GooseMessageTypes.GOOSE_CONFIG_UPDATE,
          config,
          timestamp,
        });
        provider.sendMessageToWebview({
          type: GooseMessageTypes.GOOSE_STATE_CHANGE,
          gooseState,
          gooseError,
          timestamp,
        });
      });
    } catch {
      // Best-effort — agent may not be configured yet
    }
  },

  [GOOSE_PERMISSION_RESPONSE]: async (
    { messageToken, optionId }: { messageToken: string; optionId: string },
    state,
    logger,
  ) => {
    const pending = pendingPermissions.get(messageToken);
    if (!pending) {
      logger.warn("GOOSE_PERMISSION_RESPONSE: no pending request for token", { messageToken });
      return;
    }

    pendingPermissions.delete(messageToken);

    logger.info("GOOSE_PERMISSION_RESPONSE: responding to agent", {
      requestId: pending.requestId,
      optionId,
    });

    pending.client.respondToRequest(pending.requestId, {
      outcome: { outcome: "selected", optionId },
    });

    state.mutate((draft) => {
      for (let i = draft.chatMessages.length - 1; i >= 0; i--) {
        if (draft.chatMessages[i].messageToken === messageToken) {
          draft.chatMessages[i].selectedResponse = optionId;
          break;
        }
      }
    });
  },

  [SET_EDIT_APPROVAL_MODE]: async ({ mode }: { mode: "ask" | "smart" | "auto" }, state, logger) => {
    const previousMode = state.store.getState().editApprovalMode;
    if (previousMode === mode) {
      return;
    }

    state.mutate((draft) => {
      draft.editApprovalMode = mode;
    });

    logger.info(`Edit approval mode changed: ${previousMode} -> ${mode}`);

    // Update the GOOSE_MODE env var and restart the agent so it takes effect
    const agentClient = getAgentClient(state);
    if (agentClient) {
      const gooseMode = editApprovalModeToGooseMode(mode);
      agentClient.updateModelEnv({ GOOSE_MODE: gooseMode });

      // Only restart if the agent is currently running and not mid-workflow
      if (agentClient.getState() === "running" && !state.data.isFetchingSolution) {
        logger.info("Restarting agent to apply new GOOSE_MODE", { gooseMode });
        try {
          await agentClient.stop();
          await agentClient.start();
        } catch (err) {
          logger.error("Failed to restart agent after mode change:", err);
        }
      }
    }
  },
};
