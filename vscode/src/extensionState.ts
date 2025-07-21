import { AnalyzerClient } from "./client/analyzerClient";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import * as vscode from "vscode";
import { AnalysisProfile, ExtensionData, ModifiedFileState } from "@editor-extensions/shared";
import {
  KaiFsCache,
  KaiInteractiveWorkflow,
  SolutionServerClient,
} from "@editor-extensions/agentic";
import { Immutable } from "immer";
import { IssuesModel } from "./issueView";
import { DiagnosticTaskManager } from "./taskManager/taskManager";
import { MemFS } from "./data/fileSystemProvider";
import { KonveyorFileModel } from "./diffView/fileModel";
import { EventEmitter } from "events";

export interface ExtensionState {
  analyzerClient: AnalyzerClient;
  solutionServerClient: SolutionServerClient;
  webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>;
  extensionContext: vscode.ExtensionContext;
  diagnosticCollection: vscode.DiagnosticCollection;
  memFs: MemFS;
  fileModel: KonveyorFileModel;
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
    init: (config: {
      model: any;
      workspaceDir: string;
      solutionServerClient?: SolutionServerClient;
    }) => Promise<void>;
    getWorkflow: () => KaiInteractiveWorkflow;
    dispose: () => void;
  };
  resolvePendingInteraction?: (messageId: string, response: any) => boolean;
  modifiedFiles: Map<string, ModifiedFileState>;
  modifiedFilesEventEmitter: EventEmitter;
  isWaitingForUserInteraction: boolean;
  lastMessageId: string;
  currentTaskManagerIterations: number;
}
