import { AnalyzerClient } from "./client/analyzerClient";
import { KonveyorFileModel } from "./diffView";
import { MemFS } from "./data/fileSystemProvider";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import * as vscode from "vscode";
import { AnalysisProfile, ExtensionData } from "@editor-extensions/shared";
import { KaiFsCache } from "@editor-extensions/agentic";
import { Immutable } from "immer";
import { IssuesModel } from "./issueView";
import { DiagnosticTaskManager } from "./taskManager/taskManager";
import { AdditionalInfoWorkflow } from "@editor-extensions/agentic";

export interface ExtensionState {
  analyzerClient: AnalyzerClient;
  webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>;
  extensionContext: vscode.ExtensionContext;
  diagnosticCollection: vscode.DiagnosticCollection;
  memFs?: MemFS; // Make memFs optional as we're moving to direct VSCode filesystem API
  fileModel: KonveyorFileModel;
  issueModel: IssuesModel;
  data: Immutable<ExtensionData>;
  mutateData: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
  profiles?: AnalysisProfile[];
  activeProfileId?: string;
  kaiFsCache: KaiFsCache;
  taskManager: DiagnosticTaskManager;
  workflowManager: {
    workflow: AdditionalInfoWorkflow | undefined;
    isInitialized: boolean;
    init: (config: { model: any; workspaceDir: string }) => Promise<void>;
    getWorkflow: () => AdditionalInfoWorkflow;
    dispose: () => void;
  };
}
