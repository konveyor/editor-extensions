import { AnalyzerClient } from "./client/analyzerClient";
import { KonveyorFileModel } from "./diffView";
import { MemFS } from "./data/fileSystemProvider";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import * as vscode from "vscode";
import { LocalChange, RuleSet, SolutionResponse } from "@editor-extensions/shared";
import { Immutable } from "immer";

export interface ExtensionData {
  localChanges: LocalChange[];
  ruleSets: RuleSet[];
  resolutionPanelData: any;
  isAnalyzing: boolean;
  isFetchingSolution: boolean;
  isStartingServer: boolean;
  solutionData?: SolutionResponse;
}

export interface ExtensionState {
  analyzerClient: AnalyzerClient;
  webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>;
  extensionContext: vscode.ExtensionContext;
  diagnosticCollection: vscode.DiagnosticCollection;
  memFs: MemFS;
  fileModel: KonveyorFileModel;
  data: Immutable<ExtensionData>;
  mutateData: (recipe: (draft: ExtensionData) => void) => void;
}
