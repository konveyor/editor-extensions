import * as vscode from "vscode";
import {
  GOOSE_SEND_MESSAGE,
  GOOSE_START_AGENT,
  GOOSE_STOP_AGENT,
  GOOSE_UPDATE_CONFIG,
  GOOSE_TOGGLE_VIEW,
  GOOSE_INSTALL_CLI,
  GOOSE_OPEN_SETTINGS,
  GooseMessageTypes,
} from "@editor-extensions/shared";
import type { ExtensionState } from "../../extensionState";
import type winston from "winston";

type GooseClientType = InstanceType<typeof import("../../client/gooseClient").GooseClient>;

function getGooseClient(state: ExtensionState): GooseClientType | undefined {
  return state.featureClients.get("gooseClient") as GooseClientType | undefined;
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
    const gooseClient = getGooseClient(state);
    if (!gooseClient) {
      logger.warn("GOOSE_SEND_MESSAGE: Goose client not available");
      return;
    }

    try {
      if (gooseClient.isPromptActive()) {
        logger.info("GOOSE_SEND_MESSAGE: cancelling active prompt for cancel-and-send");
        gooseClient.cancelGeneration();
      }
      await gooseClient.sendMessage(content, messageId);
    } catch (err) {
      logger.error("GOOSE_SEND_MESSAGE failed:", err);
    }
  },

  [GOOSE_START_AGENT]: async (_payload, state, logger) => {
    const gooseClient = getGooseClient(state);
    if (!gooseClient) {
      logger.warn("GOOSE_START_AGENT: Goose client not available");
      return;
    }

    try {
      await gooseClient.start();
    } catch (err) {
      logger.error("GOOSE_START_AGENT failed:", err);
    }
  },

  [GOOSE_STOP_AGENT]: async (_payload, state, logger) => {
    const gooseClient = getGooseClient(state);
    if (!gooseClient) {
      logger.warn("GOOSE_STOP_AGENT: Goose client not available");
      return;
    }

    try {
      await gooseClient.stop();
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
      const { saveGooseCredentials, hasGooseCredentials } = await import(
        "../../utilities/gooseCredentialStorage"
      );

      writeGooseConfig({
        provider: payload.provider,
        model: payload.model,
        extensions: payload.extensions,
      });
      logger.info(`Goose config updated: provider=${payload.provider}, model=${payload.model}`);

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
        logger.info(`Goose credentials saved (${Object.keys(cleaned).length} keys)`);

        const gooseClient = getGooseClient(state);
        if (gooseClient) {
          gooseClient.updateModelEnv(cleaned);
        }
      }

      const gooseClient = getGooseClient(state);
      if (gooseClient) {
        await gooseClient.stop();
        await gooseClient.start();
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
        `Failed to update Goose configuration: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },

  [GOOSE_TOGGLE_VIEW]: async (_payload, _state, logger) => {
    try {
      await vscode.commands.executeCommand("workbench.action.moveView", {
        viewId: "konveyor-core.chatView",
      });
    } catch (err) {
      logger.error("GOOSE_TOGGLE_VIEW failed:", err);
    }
  },

  [GOOSE_INSTALL_CLI]: async (_payload, state, logger) => {
    try {
      const terminal = vscode.window.createTerminal({ name: "Install Goose CLI" });
      terminal.show();

      const installCmd =
        process.platform === "win32"
          ? 'powershell -Command "irm https://github.com/block/goose/releases/download/stable/download_cli.ps1 | iex"'
          : "CONFIGURE=false curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash";

      terminal.sendText(installCmd);

      const disposable = vscode.window.onDidCloseTerminal(async (closedTerminal) => {
        if (closedTerminal === terminal) {
          disposable.dispose();
          logger.info("Goose install terminal closed, retrying agent start");
          const gooseClient = getGooseClient(state);
          if (gooseClient) {
            try {
              await gooseClient.start();
            } catch (err) {
              logger.error("Failed to start goose after install:", err);
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
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "konveyor-core.experimentalChat.gooseBinaryPath",
    );
  },

  GOOSE_WEBVIEW_READY: async (_payload, state, logger) => {
    try {
      const { readGooseConfig } = await import("../../gooseConfig");
      const { hasGooseCredentials } = await import("../../utilities/gooseCredentialStorage");
      const config = readGooseConfig();
      config.hasStoredCredentials = await hasGooseCredentials(state.extensionContext);
      const timestamp = new Date().toISOString();
      state.webviewProviders.forEach((provider) => {
        provider.sendMessageToWebview({
          type: GooseMessageTypes.GOOSE_CONFIG_UPDATE,
          config,
          timestamp,
        });
      });
    } catch {
      // Best-effort — goose may not be configured yet
    }
  },
};
