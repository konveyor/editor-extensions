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

export interface SolutionServerConfig {
  enabled: boolean;
  url: string;
  auth: {
    enabled: boolean;
    realm: string;
    insecure: boolean;
  };
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

export interface Scope {
  incidents: EnhancedIncident[];
}

export interface ScopeWithKonveyorContext {
  incident: EnhancedIncident;
}

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
  selectedResponse?: string;
  userInteraction?: any;
}

export interface ExtensionData {
  workspaceRoot: string;
  ruleSets: RuleSet[];
  enhancedIncidents: EnhancedIncident[];
  isAnalyzing: boolean;
  isFetchingSolution: boolean;
  isStartingServer: boolean;
  isInitializingServer: boolean;
  isContinueInstalled: boolean;
  isAnalysisScheduled: boolean;
  serverState: ServerState;
  solutionState: SolutionState;
  solutionScope?: Scope;
  chatMessages: ChatMessage[];
  configErrors: ConfigError[];
  profiles: AnalysisProfile[];
  activeProfileId: string | null;
  solutionServerEnabled: boolean;
  isAgentMode: boolean;
  activeDecorators?: Record<string, string>;
  solutionServerConnected: boolean;
  isWaitingForUserInteraction?: boolean;
}

export type ConfigErrorType =
  | "no-workspace"
  | "no-active-profile"
  | "invalid-label-selector"
  | "provider-not-configured"
  | "provider-connection-failed"
  | "no-custom-rules"
  | "missing-auth-credentials"
  | "genai-disabled"
  | "solution-server-disconnected";

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

  missingAuthCredentials: (): ConfigError => ({
    type: "missing-auth-credentials",
    message: "Authentication is enabled but credentials are not configured.",
  }),

  genaiDisabled: (): ConfigError => ({
    type: "genai-disabled",
    message: "GenAI functionality is disabled.",
  }),
  solutionServerDisconnected: (): ConfigError => ({
    type: "solution-server-disconnected",
    message: "Solution server is not connected",
    error:
      "The solution server is enabled but not connected. AI-powered solution suggestions may not work properly.",
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
  // Fields for in-tree and hub-synced profiles
  source?: "local" | "hub" | "bundled";
  version?: string;
  syncedAt?: string;
}

export type ToolMessageValue = { toolName: string; toolStatus: string };

export type ModifiedFileMessageValue = {
  path: string;
  status?: "applied" | "rejected" | "no_changes_needed";
  content: string;
  originalContent?: string; // Original file content from ModifiedFileState
  isNew: boolean;
  isDeleted?: boolean;
  diff: string;
  messageToken?: string;
  quickResponses?: QuickResponse[];
  userInteraction?: KaiUserInteraction;
};
export interface KaiUserInteraction {
  type: "yesNo" | "choice" | "tasks" | "modifiedFile";
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
