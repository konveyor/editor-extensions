import { Uri } from "vscode";
import { SolutionEffortLevel } from "../effort";
import { type RunnableConfig } from "@langchain/core/runnables";
import { type AIMessageChunk, type AIMessage } from "@langchain/core/messages";
import { type BaseChatModel } from "@langchain/core/language_models/chat_models";

export type WebviewType = "sidebar" | "resolution" | "profiles";

export interface Incident {
  uri: string;
  lineNumber?: number;
  message: string;
  codeSnip?: string;
}

export interface Link {
  url: string;
  title?: string;
}

export type Category = "potential" | "optional" | "mandatory";

export interface Violation {
  description: string;
  category?: Category;
  labels?: string[];
  incidents: Incident[];
  effort?: number;
}

export type EnhancedViolation = Violation & {
  id: string;
  rulesetName?: string;
  violationName?: string;
};
// Keep EnhancedIncident type aligned with KAI backend type:
// https://github.com/konveyor/kai/blob/82e195916be14eddd08c4e2bfb69afc0880edfcb/kai/analyzer_types.py#L89-L106
export interface EnhancedIncident extends Incident {
  violationId: string;
  uri: string;
  message: string;
  activeProfileName?: string;
  ruleset_name?: string;
  ruleset_description?: string;
  violation_name?: string;
  violation_description?: string;
  violation_category?: Category;
  violation_labels?: string[];
}

export interface RuleSet {
  name?: string;
  description?: string;
  tags?: string[];
  activeProfileName?: string;
  violations?: { [key: string]: EnhancedViolation };
  insights?: { [key: string]: EnhancedViolation };
  errors?: { [key: string]: string };
  unmatched?: string[];
  skipped?: string[];
}

export interface GetSolutionParams {
  file_path: string;
  incidents: Incident[];
}
export interface Change {
  // relative file path before the change, may be empty if file was created in this change
  original: string;
  // relative file path after the change, may be empty if file was deleted in this change
  modified: string;
  // diff in unified format - tested with git diffs
  diff: string;
}

export interface GetSolutionResult {
  encountered_errors: string[];
  changes: Change[];
  scope: Scope;
}

export interface LocalChange {
  modifiedUri: Uri;
  originalUri: Uri;
  diff: string;
  state: "pending" | "applied" | "discarded";
  content?: string;
  messageToken?: string;
}

export interface ResolutionMessage {
  type: string;
  solution: Solution;
  violation: Violation;
  incident: Incident;
  isRelevantSolution: boolean;
}

export interface SolutionResponse {
  diff: string;
  encountered_errors: string[];
  modified_files: string[];
}

export interface Scope {
  incidents: EnhancedIncident[];
  effort: SolutionEffortLevel;
}

export interface ScopeWithKonveyorContext {
  incident: EnhancedIncident;
}

export type Solution = GetSolutionResult | SolutionResponse;

export enum ChatMessageType {
  String = "SimpleChatMessage",
  Markdown = "MarkdownChatMessage",
  JSON = "JsonChatMessage",
  Tool = "ToolChatMessage",
  ModifiedFile = "ModifiedFileChatMessage",
}

export interface QuickResponse {
  id: string;
  content: string;
  onClick?: () => void;
  isDisabled?: boolean;
}

export interface ChatMessage {
  kind: ChatMessageType;
  value: { message: string } | Record<string, unknown>;
  chatToken?: string;
  messageToken: string;
  timestamp: string;
  extraContent?: React.ReactNode;
  quickResponses?: QuickResponse[];
  isCompact?: boolean;
}

export interface ExtensionData {
  workspaceRoot: string;
  localChanges: LocalChange[];
  ruleSets: RuleSet[];
  enhancedIncidents: EnhancedIncident[];
  resolutionPanelData: any;
  isAnalyzing: boolean;
  isFetchingSolution: boolean;
  isStartingServer: boolean;
  isInitializingServer: boolean;
  isContinueInstalled: boolean;
  isAnalysisScheduled: boolean;
  serverState: ServerState;
  solutionState: SolutionState;
  solutionData?: Solution;
  solutionScope?: Scope;
  chatMessages: ChatMessage[];
  solutionEffort: SolutionEffortLevel;
  analysisConfig: AnalysisConfig;
  profiles: AnalysisProfile[];
  activeProfileId: string | null;
  isProcessingQuickResponse: boolean;
}
export type AnalysisConfig = {
  labelSelectorValid: boolean;
  genAIConfigured: boolean;
  genAIKeyMissing: boolean;
  genAIUsingDefault: boolean;
  customRulesConfigured: boolean;
};

export type ServerState =
  | "initial"
  | "configurationNeeded"
  | "configurationReady"
  | "starting"
  | "readyToInitialize"
  | "initializing"
  | "startFailed"
  | "running"
  | "stopping"
  | "stopped";

export type SolutionState =
  | "none"
  | "started"
  | "sent"
  | "received"
  | "failedOnStart"
  | "failedOnSending";

export const DiagnosticSource = "konveyor";

export interface GenAIModelConfig {
  args?: {
    model?: string;
    [key: string]: any;
  };
  environment?: {
    OPENAI_API_KEY?: string;
    [key: string]: string | undefined;
  };
  [key: string]: any;
}

export interface GenAIConfigFile {
  models?: Record<string, GenAIModelConfig>;
  active?: GenAIModelConfig;
}

export interface GenAIConfigStatus {
  configured: boolean;
  keyMissing: boolean;
  usingDefault: boolean;
  activeKey?: string;
}
export interface AnalysisProfile {
  id: string;
  name: string;
  customRules: string[];
  useDefaultRules: boolean;
  labelSelector: string;
  readOnly?: boolean;
}

export interface BaseWorkflowMessage<KaiWorkflowMessageType, D> {
  type: KaiWorkflowMessageType;
  id: string;
  data: D;
}

export enum KaiWorkflowMessageType {
  LLMResponseChunk,
  LLMResponse,
  ModifiedFile,
  ToolCall,
  UserInteraction,
  Error,
}

export interface KaiModifiedFile {
  path: string;
  content: string;
}

export interface KaiToolCall {
  id: string;
  name?: string;
  args?: string;
  status: "generating" | "running" | "succeeded" | "failed";
}

export interface KaiUserIteraction {
  type: "yesNo" | "choice" | "tasks";
  systemMessage: {
    yesNo?: string;
    choice?: string[];
  };
  response?: {
    yesNo?: boolean;
    choice?: number;
    tasks?: {
      uri: string;
      task: string;
    }[];
  };
}

export type KaiWorkflowMessage =
  | BaseWorkflowMessage<KaiWorkflowMessageType.LLMResponseChunk, AIMessageChunk>
  | BaseWorkflowMessage<KaiWorkflowMessageType.LLMResponse, AIMessage>
  | BaseWorkflowMessage<KaiWorkflowMessageType.ModifiedFile, KaiModifiedFile>
  | BaseWorkflowMessage<KaiWorkflowMessageType.UserInteraction, KaiUserIteraction>
  | BaseWorkflowMessage<KaiWorkflowMessageType.ToolCall, KaiToolCall>
  | BaseWorkflowMessage<KaiWorkflowMessageType.Error, string>;

export type KaiUserInteractionMessage = BaseWorkflowMessage<
  KaiWorkflowMessageType.UserInteraction,
  KaiUserIteraction
>;

export interface KaiWorkflowEvents {
  on(event: "workflowMessage", listener: (msg: KaiWorkflowMessage) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
  removeAllListeners(): void;
}

export interface KaiWorkflowInitOptions {
  model: BaseChatModel;
  workspaceDir: string;
  fsCache: KaiFsCache;
}

export interface KaiWorkflowInput {
  //TODO (pgaikwad) - think about this input more
  incidents?: EnhancedIncident[];
  runnableConfig?: RunnableConfig;
}

export interface KaiWorkflowResponse {
  modified_files: KaiModifiedFile[];
  errors: Error[];
}

export interface PendingUserInteraction {
  resolve(response: KaiUserInteractionMessage | PromiseLike<KaiUserInteractionMessage>): void;
  reject(reason: any): void;
}

export interface KaiWorkflow<TWorkflowInput extends KaiWorkflowInput = KaiWorkflowInput>
  extends KaiWorkflowEvents {
  init(options: KaiWorkflowInitOptions): Promise<void>;
  run(input: TWorkflowInput): Promise<KaiWorkflowResponse>;
  resolveUserInteraction(response: KaiUserInteractionMessage): Promise<void>;
}

/**
 * Filesystem cache layer for agents. Agents do not write
 * to disk, they write to cache. Callers are supposed to
 * invalidate cache when files change on disk. In 99% cases,
 * only agents call set() to store changes they make. Others
 * are discouraged to call set() to keep memory footprint low.
 * They may call set() to notify in-flight file changes but
 * only if the uri already exists in the cache making sure
 * agents always get the most recent picture of disk.
 */
export interface KaiFsCache {
  invalidate(uri: string): Promise<void>;
  set(uri: string, content: string): Promise<void>;
  get(uri: string): Promise<string | undefined>;
  reset(): Promise<void>;

  on(event: "cacheInvalidated", listener: (uri: string) => void): this;
  on(event: "cacheSet", listener: (uri: string, content: string) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}

export type ToolMessageValue = { toolName: string; toolStatus: string };

export type ModifiedFileMessageValue = {
  path: string;
  status?: "applied" | "rejected";
  content: string;
  isNew: boolean;
  diff: string;
  messageToken?: string;
  quickResponses?: QuickResponse[];
};
