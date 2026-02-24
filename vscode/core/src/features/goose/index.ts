import * as vscode from "vscode";
import type { FeatureModule, FeatureContext } from "../featureRegistry";
import { KonveyorGUIWebviewViewProvider } from "../../KonveyorGUIWebviewViewProvider";

export const gooseFeatureModule: FeatureModule = {
  id: "goose",
  name: "Goose Chat",

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

    // Register goose message handlers
    const { gooseMessageHandlers } = await import("./gooseHandlers");
    disposables.push(ctx.registerMessageHandlers(gooseMessageHandlers));

    // Initialize the goose agent
    try {
      const { initializeGooseAgent } = await import("./gooseInit");
      const agentDisposable = await initializeGooseAgent(ctx);
      disposables.push(agentDisposable);
    } catch (err) {
      ctx.logger.error(`Failed to initialize Goose chat: ${err}`);
    }

    ctx.logger.info("Goose feature module initialized");

    return vscode.Disposable.from(...disposables);
  },
};
