import * as vscode from "vscode";
import {
  AGENT_SEND_MESSAGE,
  AGENT_START,
  AGENT_STOP,
  AGENT_UPDATE_CONFIG,
  AGENT_TOGGLE_VIEW,
  AGENT_INSTALL_CLI,
  AGENT_OPEN_SETTINGS,
  AGENT_PERMISSION_RESPONSE,
  AGENT_CANCEL_GENERATION,
  SET_EXPERIMENTAL_CHAT,
  OPEN_NATIVE_CONFIG,
  AgentMessageTypes,
} from "@editor-extensions/shared";
import { pendingPermissions } from "./init";
import type { ExtensionState } from "../../extensionState";
import type winston from "winston";
import type { AgentClient } from "../../client/agentClient";
import { executeExtensionCommand } from "../../commands";
import { getConfigAgentBackend } from "../../utilities/configuration";

function getAgentClient(state: ExtensionState): AgentClient | undefined {
  return state.featureClients.get("agentClient") as AgentClient | undefined;
}

export const agentMessageHandlers: Record<
  string,
  (payload: any, state: ExtensionState, logger: winston.Logger) => void | Promise<void>
> = {
  [AGENT_SEND_MESSAGE]: async (
    { content, messageId }: { content: string; messageId: string },
    state,
    logger,
  ) => {
    if (state.data.isFetchingSolution) {
      logger.warn("AGENT_SEND_MESSAGE: blocked — getSolution workflow is active");
      return;
    }

    const agentClient = getAgentClient(state);
    if (!agentClient) {
      logger.warn("AGENT_SEND_MESSAGE: Agent client not available");
      return;
    }

    try {
      if (agentClient.isPromptActive()) {
        logger.info("AGENT_SEND_MESSAGE: cancelling active prompt for cancel-and-send");
        agentClient.cancelGeneration();
      }
      await agentClient.sendMessage(content, messageId);
    } catch (err) {
      logger.error("AGENT_SEND_MESSAGE failed:", err);
    }
  },

  [AGENT_CANCEL_GENERATION]: async (_payload, state, logger) => {
    if (state.data.isFetchingSolution) {
      logger.warn("AGENT_CANCEL_GENERATION: blocked — getSolution workflow is active");
      return;
    }

    const agentClient = getAgentClient(state);
    if (!agentClient) {
      logger.warn("AGENT_CANCEL_GENERATION: Agent client not available");
      return;
    }

    try {
      if (agentClient.isPromptActive()) {
        logger.info("AGENT_CANCEL_GENERATION: cancelling active generation");
        agentClient.cancelGeneration();
      }
    } catch (err) {
      logger.error("AGENT_CANCEL_GENERATION failed:", err);
    }
  },

  [AGENT_START]: async (_payload, state, logger) => {
    const agentClient = getAgentClient(state);
    if (!agentClient) {
      logger.warn("AGENT_START: Agent client not available");
      return;
    }

    try {
      await agentClient.start();
    } catch (err) {
      logger.error("AGENT_START failed:", err);
    }
  },

  [AGENT_STOP]: async (_payload, state, logger) => {
    if (state.data.isFetchingSolution) {
      logger.warn("AGENT_STOP: blocked — getSolution workflow is active");
      return;
    }

    const agentClient = getAgentClient(state);
    if (!agentClient) {
      logger.warn("AGENT_STOP: Agent client not available");
      return;
    }

    try {
      await agentClient.stop();
    } catch (err) {
      logger.error("AGENT_STOP failed:", err);
    }
  },

  [AGENT_UPDATE_CONFIG]: async (
    payload: {
      provider: string;
      model: string;
      agentMode?: boolean;
      extensions: Array<{ id: string; enabled: boolean }>;
      credentials?: Record<string, string>;
    },
    state,
    logger,
  ) => {
    try {
      const { writeAgentConfig, readAgentConfig } = await import("../../agentConfigReader");
      const { saveAgentCredentials, hasAgentCredentials } =
        await import("../../utilities/agentCredentialStorage");

      writeAgentConfig({
        provider: payload.provider,
        model: payload.model,
        extensions: payload.extensions,
      });
      logger.info(`Agent config updated: provider=${payload.provider}, model=${payload.model}`);

      if (payload.credentials && Object.keys(payload.credentials).length > 0) {
        const { loadAgentCredentials } = await import("../../utilities/agentCredentialStorage");
        const existing = (await loadAgentCredentials(state.extensionContext)) ?? {};
        const merged = { ...existing, ...payload.credentials };
        const cleaned: Record<string, string> = {};
        for (const [k, v] of Object.entries(merged)) {
          if (v) {
            cleaned[k] = v;
          }
        }
        await saveAgentCredentials(state.extensionContext, cleaned);
        logger.info(`Agent credentials saved (${Object.keys(cleaned).length} keys)`);

        const agentClient = getAgentClient(state);
        if (agentClient) {
          agentClient.updateModelEnv(cleaned);
        }

        // Also write provider-settings.yaml so the DirectLLMClient fallback
        // works when the agent hasn't started yet (e.g., before a reload)
        try {
          const { generateProviderSettingsYaml } =
            await import("../../modelProvider/providerConfigGenerator");
          const { paths } = await import("../../paths");
          const vscode = await import("vscode");
          const yamlContent = generateProviderSettingsYaml(
            payload.provider,
            payload.model,
            payload.credentials,
          );
          const encoder = new TextEncoder();
          await vscode.workspace.fs.writeFile(paths().settingsYaml, encoder.encode(yamlContent));
          logger.info("Also updated provider-settings.yaml for DirectLLMClient fallback");
        } catch (err) {
          logger.warn("Failed to update provider-settings.yaml from agent config:", err);
        }
      }

      const agentClient = getAgentClient(state);
      if (agentClient) {
        await agentClient.stop();
        await agentClient.start();
      }

      const updatedConfig = readAgentConfig();
      updatedConfig.hasStoredCredentials = await hasAgentCredentials(state.extensionContext);
      if (payload.agentMode !== undefined) {
        updatedConfig.agentMode = payload.agentMode;
        state.mutate((draft) => {
          if (!draft.featureState) {
            draft.featureState = {};
          }
          draft.featureState.agentMode = payload.agentMode;
        });
        // Persist to VS Code settings
        try {
          const { updateConfigAgentMode } = await import("../../utilities/configuration");
          await updateConfigAgentMode(payload.agentMode);
        } catch (err) {
          logger.warn("Failed to persist agentMode to settings:", err);
        }
      }
      const timestamp = new Date().toISOString();
      for (const provider of state.webviewProviders.values()) {
        provider.sendMessageToWebview({
          type: AgentMessageTypes.AGENT_CONFIG_UPDATE,
          config: updatedConfig,
          timestamp,
        });
      }
    } catch (err) {
      logger.error("AGENT_UPDATE_CONFIG failed:", err);
      vscode.window.showErrorMessage(
        `Failed to update configuration: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  [AGENT_TOGGLE_VIEW]: async (_payload, state, logger) => {
    try {
      const chatProvider = state.webviewProviders?.get("chat");
      if (!chatProvider) {
        logger.warn("Chat provider not found for AGENT_TOGGLE_VIEW");
        return;
      }

      if (chatProvider.hasPanel) {
        chatProvider.closePanel();
      } else {
        chatProvider.showWebviewPanel();
        await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
      }
    } catch (err) {
      logger.error("AGENT_TOGGLE_VIEW failed:", err);
    }
  },

  [AGENT_INSTALL_CLI]: async (_payload, state, logger) => {
    try {
      const terminal = vscode.window.createTerminal({ name: "Install Agent CLI" });
      terminal.show();

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
      logger.error("AGENT_INSTALL_CLI failed:", err);
      vscode.window.showErrorMessage("Failed to open install terminal.");
    }
  },

  [AGENT_OPEN_SETTINGS]: async () => {
    const backend = getConfigAgentBackend();
    const settingsKey =
      backend === "opencode"
        ? "konveyor-core.experimentalChat.opencodeBinaryPath"
        : "konveyor-core.experimentalChat.gooseBinaryPath";
    await vscode.commands.executeCommand("workbench.action.openSettings", settingsKey);
  },

  AGENT_WEBVIEW_READY: async (_payload, state, _logger) => {
    try {
      const { readAgentConfig } = await import("../../agentConfigReader");
      const { hasAgentCredentials } = await import("../../utilities/agentCredentialStorage");
      const config = readAgentConfig();
      config.hasStoredCredentials = await hasAgentCredentials(state.extensionContext);
      config.agentMode = (state.store.getState().featureState?.agentMode as boolean) ?? true;
      const timestamp = new Date().toISOString();

      const currentAgentState =
        (state.store.getState().featureState?.agentState as string) ?? "stopped";
      const agentError = state.store.getState().featureState?.agentError as string | undefined;

      state.webviewProviders.forEach((provider) => {
        provider.sendMessageToWebview({
          type: AgentMessageTypes.AGENT_CONFIG_UPDATE,
          config,
          timestamp,
        });
        provider.sendMessageToWebview({
          type: AgentMessageTypes.AGENT_STATE_CHANGE,
          agentState: currentAgentState,
          agentError,
          timestamp,
        });
      });
    } catch {
      // Best-effort — agent may not be configured yet
    }
  },

  [AGENT_PERMISSION_RESPONSE]: async (
    { messageToken, optionId }: { messageToken: string; optionId: string },
    state,
    logger,
  ) => {
    const pending = pendingPermissions.get(messageToken);
    if (!pending) {
      logger.warn("AGENT_PERMISSION_RESPONSE: no pending request for token", { messageToken });
      return;
    }

    pendingPermissions.delete(messageToken);

    logger.info("AGENT_PERMISSION_RESPONSE: responding to agent", {
      requestId: pending.requestId,
      optionId,
    });

    pending.client.respondToRequest(pending.requestId, {
      outcome: { outcome: "selected", optionId },
    });

    // Determine if accepted or rejected
    const accepted = optionId.includes("allow");

    state.mutate((draft) => {
      for (let i = draft.chatMessages.length - 1; i >= 0; i--) {
        if (draft.chatMessages[i].messageToken === messageToken) {
          draft.chatMessages[i].selectedResponse = optionId;
          break;
        }
      }
    });

    // Notify solution server of the decision (backend handles actual file writes)
    if (pending.filePath) {
      try {
        if (accepted) {
          await executeExtensionCommand(
            "changeApplied",
            pending.filePath,
            pending.fileContent ?? "",
          );
        } else {
          await executeExtensionCommand("changeDiscarded", pending.filePath);
        }
      } catch (err) {
        logger.warn("Failed to notify solution server of permission outcome", { err });
      }
    }
  },

  [SET_EXPERIMENTAL_CHAT]: async ({ enabled }: { enabled: boolean }, state, logger) => {
    logger.info(`SET_EXPERIMENTAL_CHAT: ${enabled}`);

    try {
      const { updateConfigExperimentalChatEnabled } = await import("../../utilities/configuration");
      await updateConfigExperimentalChatEnabled(enabled);

      state.mutate((draft) => {
        draft.experimentalChatEnabled = enabled;
      });

      if (enabled && !getAgentClient(state)) {
        vscode.window
          .showInformationMessage(
            "Experimental Chat enabled. Reload the window to start the agent backend.",
            "Reload Window",
          )
          .then((selection) => {
            if (selection === "Reload Window") {
              vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
          });
      }
    } catch (err) {
      logger.error("SET_EXPERIMENTAL_CHAT failed:", err);
    }
  },

  [OPEN_NATIVE_CONFIG]: async (_payload, state, logger) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const { getAgentConfigPath } = await import("../../agentConfigReader");
      const backend = getConfigAgentBackend();
      const configPath = getAgentConfigPath(backend, state.store.getState().workspaceRoot);

      if (!fs.existsSync(configPath)) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, "", "utf-8");
      }

      const uri = vscode.Uri.file(configPath);
      await vscode.commands.executeCommand("vscode.open", uri);
    } catch (err) {
      logger.error("OPEN_NATIVE_CONFIG failed:", err);
    }
  },
};
