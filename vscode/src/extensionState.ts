import { AnalyzerClient } from "./client/analyzerClient";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import * as vscode from "vscode";
import { AnalysisProfile, ExtensionData } from "@editor-extensions/shared";
import { KaiFsCache, KaiInteractiveWorkflow } from "@editor-extensions/agentic";
import { Immutable } from "immer";
import { IssuesModel } from "./issueView";
import { DiagnosticTaskManager } from "./taskManager/taskManager";

export interface ExtensionState {
  analyzerClient: AnalyzerClient;
  webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>;
  extensionContext: vscode.ExtensionContext;
  diagnosticCollection: vscode.DiagnosticCollection;
  issueModel: IssuesModel;
  data: Immutable<ExtensionData>;
  mutateData: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
  profiles?: AnalysisProfile[];
  activeProfileId?: string;
  kaiFsCache: KaiFsCache;
  taskManager: DiagnosticTaskManager;
  workflowManager: {
    workflow: KaiInteractiveWorkflow | undefined;
    isInitialized: boolean;
    init: (config: { model: any; workspaceDir: string }) => Promise<void>;
    getWorkflow: () => KaiInteractiveWorkflow;
    dispose: () => void;
  };
  resolvePendingInteraction?: (messageId: string, response: any) => boolean;
}
