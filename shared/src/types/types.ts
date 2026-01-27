export type WebviewType = "sidebar" | "resolution" | "profiles" | "hub";

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

export interface HubConfig {
  enabled: boolean;
  url: string;
  auth: {
    enabled: boolean;
    username: string;
    password: string;
    insecure: boolean;
  };
  features: {
    solutionServer: {
      enabled: boolean;
    };
    profileSync: {
      enabled: boolean;
    };
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
  BatchReview = "BatchReviewChatMessage",
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

export interface PendingBatchReviewFile {
  messageToken: string;
  path: string;
  diff: string;
  content: string;
  originalContent?: string;
  isNew: boolean;
  isDeleted: boolean;
  hasError?: boolean;
}

export interface ExtensionData {
  workspaceRoot: string;
  ruleSets: RuleSet[];
  enhancedIncidents: EnhancedIncident[];
  isAnalyzing: boolean;
  analysisProgress?: number;
  analysisProgressMessage?: string;
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
  llmErrors: LLMError[];
  profiles: AnalysisProfile[];
  activeProfileId: string | null;
  isInTreeMode: boolean;
  solutionServerEnabled: boolean;
  isAgentMode: boolean;
  activeDecorators?: Record<string, string>;
  solutionServerConnected: boolean;
  isWaitingForUserInteraction?: boolean;
  hubConfig: HubConfig | undefined;
  hubForced?: boolean;
  isProcessingQueuedMessages?: boolean;
  pendingBatchReview?: PendingBatchReviewFile[];
  profileSyncEnabled: boolean;
  profileSyncConnected: boolean;
  isSyncingProfiles: boolean;
  llmProxyAvailable: boolean;
  isWebEnvironment: boolean;
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
  | "solution-server-disconnected"
  | "no-hub-profiles"
  | "hub-profile-sync-failed";

export type LLMErrorType =
  | "workflow-initialization-failed"
  | "llm-request-failed"
  | "llm-response-parse-failed"
  | "llm-timeout"
  | "llm-rate-limit"
  | "llm-context-limit"
  | "llm-unknown-error";

export interface LLMError {
  type: LLMErrorType;
  message: string;
  error?: string;
  timestamp: string;
}

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

  noHubProfiles: (): ConfigError => ({
    type: "no-hub-profiles",
    message: "No profiles available from Hub",
    error:
      "Profile sync is enabled but no profiles were found. Either the application is not registered in Hub, or it has no profiles configured. You can create local profiles or configure profiles in Hub.",
  }),

  hubProfileSyncFailed: (failedCount: number, totalCount: number, error?: string): ConfigError => ({
    type: "hub-profile-sync-failed",
    message: `Failed to sync ${failedCount} of ${totalCount} profiles from Hub`,
    error:
      error ||
      "Some profiles could not be downloaded from Hub. The profile bundles may not be ready yet.",
  }),
};

export const createLLMError = {
  workflowInitializationFailed: (error?: string): LLMError => ({
    type: "workflow-initialization-failed",
    message: "Failed to initialize AI workflow. Please check your model configuration.",
    error,
    timestamp: new Date().toISOString(),
  }),

  llmRequestFailed: (error?: string): LLMError => ({
    type: "llm-request-failed",
    message: "Failed to get response from AI model. Please try again.",
    error,
    timestamp: new Date().toISOString(),
  }),

  llmResponseParseFailed: (error?: string): LLMError => ({
    type: "llm-response-parse-failed",
    message: "Failed to parse AI model response. The response format may be invalid.",
    error,
    timestamp: new Date().toISOString(),
  }),

  llmTimeout: (): LLMError => ({
    type: "llm-timeout",
    message: "AI model request timed out. Please try again or check your connection.",
    timestamp: new Date().toISOString(),
  }),

  llmRateLimit: (): LLMError => ({
    type: "llm-rate-limit",
    message: "AI model rate limit exceeded. Please wait a moment before trying again.",
    timestamp: new Date().toISOString(),
  }),

  llmContextLimit: (): LLMError => ({
    type: "llm-context-limit",
    message: "Request exceeds AI model context limit. Try analyzing fewer issues at once.",
    timestamp: new Date().toISOString(),
  }),

  llmUnknownError: (error?: string): LLMError => ({
    type: "llm-unknown-error",
    message: "An unexpected error occurred with the AI model.",
    error,
    timestamp: new Date().toISOString(),
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
  readOnly?: boolean; // If true, don't show Apply/Reject buttons (just context)
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
