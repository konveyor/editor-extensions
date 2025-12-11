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
import { MessageQueueManager } from "./utilities/ModifiedFiles/queueManager";
import { HubConnectionManager } from "./hub";

export interface ExtensionState {
  analyzerClient: AnalyzerClient;
  hubConnectionManager: HubConnectionManager;
  webviewProviders: Map<string, KonveyorGUIWebviewViewProvider>;
  extensionContext: vscode.ExtensionContext;
  diagnosticCollection: vscode.DiagnosticCollection;
  issueModel: IssuesModel;
  data: Immutable<ExtensionData>;
  mutateChatMessages: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
  mutateAnalysisState: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
  mutateSolutionWorkflow: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
  mutateServerState: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
  mutateProfiles: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
  mutateConfigErrors: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
  mutateDecorators: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
  mutateSettings: (recipe: (draft: ExtensionData) => void) => Immutable<ExtensionData>;
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
      solutionServerClient?: SolutionServerClient | undefined;
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
  currentQueueManager?: MessageQueueManager;
  pendingInteractionsMap?: Map<string, (response: any) => void>;
}
