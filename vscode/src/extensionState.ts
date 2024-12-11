import { AnalyzerClient } from "./client/analyzerClient";
import { KonveyorFileModel } from "./diffView";
import { MemFS } from "./data/fileSystemProvider";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import * as vscode from "vscode";
import { ExtensionData } from "@editor-extensions/shared";
import { Immutable } from "immer";
import { IssuesModel } from "./issueView";

export interface ExtensionState {
  analyzerClient: AnalyzerClient;
  webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>;
  extensionContext: vscode.ExtensionContext;
  diagnosticCollection: vscode.DiagnosticCollection;
  memFs: MemFS;
  fileModel: KonveyorFileModel;
  issueModel: IssuesModel;
  data: Immutable<ExtensionData>;
  mutateData: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
}
