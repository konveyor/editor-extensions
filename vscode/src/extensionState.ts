import { AnalyzerClient } from "./client/analyzerClient";
import { KonveyorFileModel } from "./diffView";
import { MemFS } from "./data/fileSystemProvider";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import * as vscode from "vscode";
import { LocalChange, RuleSet } from "@editor-extensions/shared";
import { EventEmitter } from "vscode";

type SharedStateEventData = any; // Or use a specific type if needed

export class SharedState {
  private state: Map<string, any> = new Map();
  private emitter: EventEmitter<SharedStateEventData> = new EventEmitter<SharedStateEventData>();

  get(key: string) {
    return this.state.get(key);
  }

  set(key: string, value: any) {
    this.state.set(key, value);
    this.emitter.fire({ key, value }); // Emit an event for the key when data is set
  }

  // Subscribe to an event for a specific key
  on(callback: (data: { key: string; value: SharedStateEventData }) => void) {
    // Listen for events and pass data to the callback
    this.emitter.event(callback);
  }

  // Remove a listener for the event
  off(callback: (data: { key: string; value: SharedStateEventData }) => void) {
    // Remove the specific listener callback
    this.emitter.event(callback);
  }
}

export interface ExtensionState {
  analyzerClient: AnalyzerClient;
  sharedState: SharedState;
  webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>;
  extensionContext: vscode.ExtensionContext;
  diagnosticCollection: vscode.DiagnosticCollection;
  memFs: MemFS;
  fileModel: KonveyorFileModel;
  localChanges: LocalChange[];
  ruleSets: RuleSet[];
}
