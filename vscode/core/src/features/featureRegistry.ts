import * as vscode from "vscode";
import winston from "winston";
import { ExtensionData } from "@editor-extensions/shared";
import { type ExtensionStore } from "../store/extensionStore";
import { KonveyorGUIWebviewViewProvider } from "../KonveyorGUIWebviewViewProvider";

export interface FeatureModule {
  readonly id: string;
  readonly name: string;
  isEnabled(): boolean;
  initialize(ctx: FeatureContext): Promise<vscode.Disposable>;
}

export interface FeatureContext {
  readonly extensionContext: vscode.ExtensionContext;
  readonly store: ExtensionStore;
  readonly mutate: (recipe: (draft: ExtensionData) => void) => void;
  readonly logger: winston.Logger;
  readonly webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>;
  readonly featureClients: Map<string, unknown>;
  registerMessageHandlers(
    handlers: Record<
      string,
      (payload: any, state: any, logger: winston.Logger) => void | Promise<void>
    >,
  ): vscode.Disposable;
  registerWebviewProvider(
    viewType: string,
    provider: vscode.WebviewViewProvider,
    options?: { webviewOptions?: { retainContextWhenHidden?: boolean } },
  ): vscode.Disposable;
}

export class FeatureRegistry implements vscode.Disposable {
  private modules: Map<string, FeatureModule> = new Map();
  private disposables: Map<string, vscode.Disposable> = new Map();

  constructor(private logger: winston.Logger) {}

  register(module: FeatureModule): void {
    if (this.modules.has(module.id)) {
      this.logger.warn(`Feature module ${module.id} is already registered, overwriting`);
    }
    this.modules.set(module.id, module);
    this.logger.info(`Feature module registered: ${module.name} (${module.id})`);
  }

  async initAll(ctx: FeatureContext): Promise<void> {
    for (const [id, module] of this.modules) {
      if (!module.isEnabled()) {
        this.logger.info(`Feature module skipped (disabled): ${module.name} (${id})`);
        continue;
      }

      try {
        const featureLogger = ctx.logger.child({ feature: id });
        const featureCtx: FeatureContext = { ...ctx, logger: featureLogger };
        const disposable = await module.initialize(featureCtx);
        this.disposables.set(id, disposable);
        this.logger.info(`Feature module initialized: ${module.name} (${id})`);
      } catch (error) {
        this.logger.error(`Feature module failed to initialize: ${module.name} (${id}): ${error}`);
      }
    }
  }

  isFeatureEnabled(id: string): boolean {
    const module = this.modules.get(id);
    return module ? module.isEnabled() : false;
  }

  getModule(id: string): FeatureModule | undefined {
    return this.modules.get(id);
  }

  dispose(): void {
    for (const [id, disposable] of this.disposables) {
      try {
        disposable.dispose();
      } catch (error) {
        this.logger.error(`Error disposing feature module ${id}:`, error);
      }
    }
    this.disposables.clear();
    this.modules.clear();
  }
}
