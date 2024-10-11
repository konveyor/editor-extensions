import { AnalyzerClient } from "./client/analyzerClient";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import * as vscode from "vscode";

export class SharedState {
  private state: Map<string, any> = new Map();

  get(key: string) {
    return this.state.get(key);
  }

  set(key: string, value: any) {
    this.state.set(key, value);
  }
}

export interface ExtensionState {
  analyzerClient: AnalyzerClient;
  sharedState: SharedState;
  webviewProviders: Set<KonveyorGUIWebviewViewProvider>;
  sidebarProvider: KonveyorGUIWebviewViewProvider;
  extensionContext: vscode.ExtensionContext; // Add this line
}
