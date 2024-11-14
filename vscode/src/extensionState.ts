import { AnalyzerClient } from "./client/analyzerClient";
import { KonveyorFileModel } from "./diffView";
import { MemFS } from "./data/fileSystemProvider";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import * as vscode from "vscode";
import { LocalChange } from "./data/virtualStorage";
import { RuleSet } from "@editor-extensions/shared";

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
  extensionContext: vscode.ExtensionContext;
  diagnosticCollection: vscode.DiagnosticCollection;
  memFs: MemFS;
  fileModel: KonveyorFileModel;
  localChanges: LocalChange[];
  ruleSets: RuleSet[];
}
