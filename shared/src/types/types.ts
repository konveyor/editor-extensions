import { Uri } from "vscode";

import { SolutionEffortLevel } from "../effort";

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

export interface SuccessRateMetric {
  counted_solutions: number;
  accepted_solutions: number;
  rejected_solutions: number;
  modified_solutions: number;
  pending_solutions: number;
  unknown_solutions: number;
}

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
  solutionServerIncidentId?: number;
  ruleset_name?: string;
  ruleset_description?: string;
  violation_name?: string;
  violation_description?: string;
  violation_category?: Category;
  violation_labels?: string[];
  successRateMetric?: SuccessRateMetric;
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
  // solution server id
  solutionId?: number;
}

export interface GetSolutionResult {
  encountered_errors: string[];
  changes: Change[];
  scope: Scope;
  clientId: string;
}

export interface LocalChange {
  modifiedUri: Uri;
  originalUri: Uri;
  diff: string;
  state: "pending" | "applied" | "discarded";
  solutionId?: number;
  clientId: string;
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
  clientId: string;
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
  configErrors: ConfigError[];
  profiles: AnalysisProfile[];
  activeProfileId: string | null;
  solutionServerEnabled: boolean;
  isAgentMode: boolean;
}

export type ConfigErrorType =
  | "no-workspace"
  | "no-active-profile"
  | "invalid-label-selector"
  | "provider-not-configured"
  | "provider-connection-failed"
  | "no-custom-rules";

export interface ConfigError {
  type: ConfigErrorType;
  message: string;
  error?: string;
}

export const createConfigError = {
  noWorkspace: (): ConfigError => ({
    type: "no-workspace",
    message: "Please open a workspace folder before using this extension.",
  }),

  noActiveProfile: (): ConfigError => ({
    type: "no-active-profile",
    message: "No active profile selected",
  }),

  invalidLabelSelector: (): ConfigError => ({
    type: "invalid-label-selector",
    message: "Label selector is not configured.",
  }),

  providerNotConfigured: (): ConfigError => ({
    type: "provider-not-configured",
    message: "Provider is not properly configured.",
  }),

  providerConnnectionFailed: (): ConfigError => ({
    type: "provider-connection-failed",
    message: "Failed to establish connection to the model.",
  }),

  noCustomRules: (): ConfigError => ({
    type: "no-custom-rules",
    message: "No custom rules configured and default rules are disabled.",
  }),
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

export interface ProviderConfigFile {
  models?: Record<string, GenAIModelConfig>;
  active?: GenAIModelConfig;
}

export interface AnalysisProfile {
  id: string;
  name: string;
  customRules: string[];
  useDefaultRules: boolean;
  labelSelector: string;
  readOnly?: boolean;
}

export type ToolMessageValue = { toolName: string; toolStatus: string };

export type ModifiedFileMessageValue = {
  path: string;
  status?: "applied" | "rejected";
  content: string;
  originalContent?: string; // Original file content from ModifiedFileState
  isNew: boolean;
  isDeleted?: boolean;
  diff: string;
  messageToken?: string;
  quickResponses?: QuickResponse[];
};

export interface ModifiedFileState {
  // if a file is newly created, original content can be undefined
  originalContent: string | undefined;
  modifiedContent: string;
  editType: "inMemory" | "toDisk";
}

/**
 * A general purpose cache to store and retrieve inputs and their corresponding outputs.
 *
 * @template K - The type of the input to cache.
 * @template V - The type of the value for the given input to cache.
 * @template C - The coordinates of the cache.
 * @template O - Any additional options for the cache.
 */
export interface InputOutputCache<K, V, C, O> {
  enabled: boolean;
  get(input: K, opts?: O): Promise<V | undefined>;
  set(input: K, value: V, opts?: O): Promise<C | undefined>;
  invalidate(input: K, opts?: O): Promise<void>;
  reset(): Promise<void>;
}

export const KONVEYOR_OUTPUT_CHANNEL_NAME = "Konveyor";
