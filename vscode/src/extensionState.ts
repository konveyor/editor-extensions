import { AnalyzerClient } from "./client/analyzerClient";
import { KonveyorGUIWebviewViewProvider } from "./KonveyorGUIWebviewViewProvider";
import * as vscode from "vscode";
import { AnalysisProfile, ExtensionData, ModifiedFileState } from "@editor-extensions/shared";
import {
  type InMemoryCacheWithRevisions,
  type KaiInteractiveWorkflow,
  type KaiModelProvider,
  type SolutionServerClient,
} from "@editor-extensions/agentic";
import { Immutable } from "immer";
import { IssuesModel } from "./issueView";
import { DiagnosticTaskManager } from "./taskManager/taskManager";
import { EventEmitter } from "events";
import winston from "winston";
import { VerticalDiffManager } from "./diff/vertical/manager";
import { StaticDiffAdapter } from "./diff/staticDiffAdapter";
import { BatchedAnalysisTrigger } from "./analysis/batchedAnalysisTrigger";

export interface ExtensionState {
  analyzerClient: AnalyzerClient;
  solutionServerClient: SolutionServerClient;
  webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>;
  extensionContext: vscode.ExtensionContext;
  diagnosticCollection: vscode.DiagnosticCollection;
  issueModel: IssuesModel;
  data: Immutable<ExtensionData>;
  mutateData: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
  profiles?: AnalysisProfile[];
  activeProfileId?: string;
  kaiFsCache: InMemoryCacheWithRevisions<string, string>;
  taskManager: DiagnosticTaskManager;
  workflowManager: {
    workflow: KaiInteractiveWorkflow | undefined;
    isInitialized: boolean;
    init: (config: {
      modelProvider: KaiModelProvider;
      workspaceDir: string;
      solutionServerClient?: SolutionServerClient;
    }) => Promise<void>;
    getWorkflow: () => KaiInteractiveWorkflow;
    dispose: () => void;
  };
  workflowDisposalPending?: boolean;
  resolvePendingInteraction?: (messageId: string, response: any) => boolean;
  modifiedFiles: Map<string, ModifiedFileState>;
  modifiedFilesEventEmitter: EventEmitter;
  lastMessageId: string;
  currentTaskManagerIterations: number;
  logger: winston.Logger;
  modelProvider: KaiModelProvider | undefined;
  verticalDiffManager?: VerticalDiffManager;
  staticDiffAdapter?: StaticDiffAdapter;
  batchedAnalysisTrigger?: BatchedAnalysisTrigger;
}
