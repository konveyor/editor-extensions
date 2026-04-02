import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type {
  RuleSet,
  EnhancedIncident,
  ChatMessage,
  AnalysisProfile,
  ConfigError,
  ServerState,
  SolutionState,
  Scope,
  PendingBatchReviewFile,
  HubConfig,
  AgentState,
  AgentChatMessage,
  AgentContentBlockType,
  AgentConfig,
  ToolPermissionPolicy,
} from "@editor-extensions/shared";
import { DEFAULT_TOOL_PERMISSION_POLICY } from "@editor-extensions/shared";

const MAX_CHAT_MESSAGES = 50000;

interface ExtensionStore {
  // Analysis state
  ruleSets: RuleSet[];
  enhancedIncidents: EnhancedIncident[];
  profiles: AnalysisProfile[];
  activeProfileId: string | null;
  isInTreeMode: boolean; // True when all profiles are from filesystem (local or hub)
  isAnalyzing: boolean;
  analysisProgress?: number;
  analysisProgressMessage?: string;
  isAnalysisScheduled: boolean;
  serverState: ServerState;

  // Chat state
  chatMessages: ChatMessage[];

  // UI state
  isFetchingSolution: boolean;
  isStartingServer: boolean;
  isInitializingServer: boolean;
  isWaitingForUserInteraction: boolean;
  isProcessingQueuedMessages: boolean;
  activeDecorators: Record<string, string>;

  // Config state
  workspaceRoot: string;
  configErrors: ConfigError[];
  solutionState: SolutionState;
  solutionScope?: Scope;
  solutionServerEnabled: boolean;
  solutionServerConnected: boolean;
  isContinueInstalled: boolean;
  hubConfig?: HubConfig;
  hubForced?: boolean;
  profileSyncEnabled: boolean;
  profileSyncConnected: boolean;
  isSyncingProfiles: boolean;
  llmProxyAvailable: boolean;
  isWebEnvironment: boolean;
  availableTargets: string[];
  availableSources: string[];

  // Feature flags
  experimentalChatEnabled: boolean;
  modelSupportsTools: boolean;

  // Batch review state
  isBatchReviewMode: boolean;
  pendingBatchReview: PendingBatchReviewFile[];
  isBatchOperationInProgress: boolean;

  // Focus/filter state (from tree view "Open Details")
  focusedViolationFilter: string | null;

  // Tool permission policy
  toolPermissions: ToolPermissionPolicy;

  // Agent chat state (experimental)
  agentMessages: AgentChatMessage[];
  agentState: AgentState;
  agentError?: string;
  agentConfig: AgentConfig | null;

  setRuleSets: (ruleSets: RuleSet[]) => void;
  setEnhancedIncidents: (incidents: EnhancedIncident[]) => void;
  setIsAnalyzing: (isAnalyzing: boolean) => void;
  setAnalysisProgress: (progress: number) => void;
  setAnalysisProgressMessage: (message: string) => void;
  setIsAnalysisScheduled: (isScheduled: boolean) => void;
  setServerState: (state: ServerState) => void;
  setProfiles: (profiles: AnalysisProfile[]) => void;
  setActiveProfileId: (profileId: string | null) => void;

  addChatMessage: (message: ChatMessage) => void;
  clearChatMessages: () => void;
  setChatMessages: (messages: ChatMessage[]) => void;

  setIsFetchingSolution: (isFetching: boolean) => void;
  setIsStartingServer: (isStarting: boolean) => void;
  setIsInitializingServer: (isInitializing: boolean) => void;
  setIsWaitingForUserInteraction: (isWaiting: boolean) => void;
  setIsProcessingQueuedMessages: (isProcessing: boolean) => void;
  setBatchOperationInProgress: (isInProgress: boolean) => void;
  setActiveDecorators: (decorators: Record<string, string>) => void;
  deleteActiveDecorator: (streamId: string) => void;

  setConfigErrors: (errors: ConfigError[]) => void;
  addConfigError: (error: ConfigError) => void;
  clearConfigErrors: () => void;
  setSolutionState: (state: SolutionState) => void;
  setSolutionScope: (scope: Scope | undefined) => void;
  setSolutionServerConnected: (connected: boolean) => void;
  setSolutionServerEnabled: (enabled: boolean) => void;
  setIsContinueInstalled: (isInstalled: boolean) => void;
  setHubConfig: (config: HubConfig | undefined) => void;
  setHubForced: (forced: boolean | undefined) => void;
  setWorkspaceRoot: (root: string) => void;
  setProfileSyncEnabled: (enabled: boolean) => void;
  setProfileSyncConnected: (connected: boolean) => void;
  setIsSyncingProfiles: (isSyncing: boolean) => void;
  setLlmProxyAvailable: (available: boolean) => void;
  setFocusedViolationFilter: (filter: string | null) => void;
  setIsWebEnvironment: (isWeb: boolean) => void;
  setToolPermissions: (policy: ToolPermissionPolicy) => void;
  setExperimentalChatEnabled: (enabled: boolean) => void;

  // Agent chat setters
  setAgentConfig: (config: AgentConfig | null) => void;
  setAgentMessages: (messages: AgentChatMessage[]) => void;
  setAgentState: (state: AgentState) => void;
  setAgentError: (error: string | undefined) => void;
  appendAgentStreamingChunk: (
    messageId: string,
    content: string,
    contentType?: AgentContentBlockType,
    resourceData?: { uri?: string; name?: string; mimeType?: string; text?: string },
  ) => void;
  finalizeAgentMessage: (messageId: string, stopReason?: string) => void;
  cancelAgentMessage: (messageId: string) => void;
  setAgentThinking: (messageId: string, isThinking: boolean) => void;
  updateAgentToolCall: (
    messageId: string,
    toolName: string,
    status: "running" | "succeeded" | "failed",
    result?: string,
  ) => void;

  // Utility
  clearAnalysisData: () => void;

  // Batch updates for complex state changes
  batchUpdate: (updates: Partial<ExtensionStore>) => void;
}

export const useExtensionStore = create<ExtensionStore>()(
  devtools(
    immer((set) => ({
      // Initial state
      ruleSets: [],
      enhancedIncidents: [],
      profiles: [],
      activeProfileId: null,
      isInTreeMode: false,
      isAnalyzing: false,
      analysisProgress: 0,
      analysisProgressMessage: "",
      isAnalysisScheduled: false,
      serverState: "initial",
      chatMessages: [],
      isFetchingSolution: false,
      isStartingServer: false,
      isInitializingServer: false,
      isWaitingForUserInteraction: false,
      isProcessingQueuedMessages: false,
      activeDecorators: {},
      workspaceRoot: "/",
      configErrors: [],
      solutionState: "none",
      solutionScope: undefined,
      solutionServerEnabled: false,
      solutionServerConnected: false,
      isContinueInstalled: false,
      hubConfig: undefined,
      hubForced: undefined,
      profileSyncEnabled: false,
      profileSyncConnected: false,
      isSyncingProfiles: false,
      llmProxyAvailable: false,
      isWebEnvironment: false,
      availableTargets: [],
      availableSources: [],

      // Tool permission policy
      toolPermissions: DEFAULT_TOOL_PERMISSION_POLICY,

      // Feature flags
      experimentalChatEnabled: false,
      modelSupportsTools: true,

      // Batch review state
      isBatchReviewMode: false,
      pendingBatchReview: [],
      isBatchOperationInProgress: false,

      // Focus/filter state
      focusedViolationFilter: null,

      // Agent chat state
      agentMessages: [],
      agentState: "stopped" as AgentState,
      agentError: undefined,
      agentConfig: null,

      setRuleSets: (ruleSets) =>
        set((state) => {
          state.ruleSets = ruleSets;
        }),

      setEnhancedIncidents: (incidents) =>
        set((state) => {
          state.enhancedIncidents = incidents;
        }),

      setIsAnalyzing: (isAnalyzing) =>
        set((state) => {
          state.isAnalyzing = isAnalyzing;
        }),

      setAnalysisProgress: (progress) =>
        set((state) => {
          state.analysisProgress = progress;
        }),

      setAnalysisProgressMessage: (message) =>
        set((state) => {
          state.analysisProgressMessage = message;
        }),

      setIsAnalysisScheduled: (isScheduled) =>
        set((state) => {
          state.isAnalysisScheduled = isScheduled;
        }),

      setServerState: (serverState) =>
        set((state) => {
          state.serverState = serverState;
        }),

      setProfiles: (profiles) =>
        set((state) => {
          state.profiles = profiles;
        }),

      setActiveProfileId: (profileId) =>
        set((state) => {
          state.activeProfileId = profileId;
        }),

      addChatMessage: (message) =>
        set((state) => {
          state.chatMessages.push(message);

          if (state.chatMessages.length > MAX_CHAT_MESSAGES) {
            const droppedCount = state.chatMessages.length - MAX_CHAT_MESSAGES;
            state.chatMessages = state.chatMessages.slice(-MAX_CHAT_MESSAGES);
            console.warn(
              `Chat messages exceeded limit in addChatMessage. ` +
                `Dropping ${droppedCount} oldest messages, keeping the most recent ${MAX_CHAT_MESSAGES}.`,
            );
          }
        }),

      clearChatMessages: () =>
        set((state) => {
          state.chatMessages = [];
        }),

      setChatMessages: (messages) =>
        set((state) => {
          state.chatMessages = messages;
        }),

      setIsFetchingSolution: (isFetching) =>
        set((state) => {
          state.isFetchingSolution = isFetching;
        }),

      setIsStartingServer: (isStarting) =>
        set((state) => {
          state.isStartingServer = isStarting;
        }),

      setIsInitializingServer: (isInitializing) =>
        set((state) => {
          state.isInitializingServer = isInitializing;
        }),

      setIsWaitingForUserInteraction: (isWaiting) =>
        set((state) => {
          state.isWaitingForUserInteraction = isWaiting;
        }),

      setIsProcessingQueuedMessages: (isProcessing) =>
        set((state) => {
          state.isProcessingQueuedMessages = isProcessing;
        }),

      setBatchOperationInProgress: (isInProgress) =>
        set((state) => {
          state.isBatchOperationInProgress = isInProgress;
        }),

      setActiveDecorators: (decorators) =>
        set((state) => {
          state.activeDecorators = decorators;
        }),

      deleteActiveDecorator: (streamId) =>
        set((state) => {
          if (state.activeDecorators && state.activeDecorators[streamId]) {
            delete state.activeDecorators[streamId];
          }
        }),

      setConfigErrors: (errors) =>
        set((state) => {
          state.configErrors = errors;
        }),

      addConfigError: (error) =>
        set((state) => {
          state.configErrors.push(error);
        }),

      clearConfigErrors: () =>
        set((state) => {
          state.configErrors = [];
        }),

      setSolutionState: (solutionState) =>
        set((state) => {
          state.solutionState = solutionState;
        }),

      setSolutionScope: (scope) =>
        set((state) => {
          state.solutionScope = scope;
        }),

      setSolutionServerConnected: (connected) =>
        set((state) => {
          state.solutionServerConnected = connected;
        }),

      setSolutionServerEnabled: (enabled) =>
        set((state) => {
          state.solutionServerEnabled = enabled;
        }),

      setIsContinueInstalled: (isInstalled) =>
        set((state) => {
          state.isContinueInstalled = isInstalled;
        }),

      setHubConfig: (config) =>
        set((state) => {
          state.hubConfig = config;
        }),

      setHubForced: (forced) =>
        set((state) => {
          state.hubForced = forced;
        }),

      setWorkspaceRoot: (root) =>
        set((state) => {
          state.workspaceRoot = root;
        }),

      setProfileSyncEnabled: (enabled) =>
        set((state) => {
          state.profileSyncEnabled = enabled;
        }),

      setProfileSyncConnected: (connected) =>
        set((state) => {
          state.profileSyncConnected = connected;
        }),

      setIsSyncingProfiles: (isSyncing) =>
        set((state) => {
          state.isSyncingProfiles = isSyncing;
        }),

      setLlmProxyAvailable: (available) =>
        set((state) => {
          state.llmProxyAvailable = available;
        }),

      setFocusedViolationFilter: (filter) =>
        set((state) => {
          state.focusedViolationFilter = filter;
        }),

      setIsWebEnvironment: (isWeb) =>
        set((state) => {
          state.isWebEnvironment = isWeb;
        }),

      setToolPermissions: (policy) =>
        set((state) => {
          state.toolPermissions = policy;
        }),

      setExperimentalChatEnabled: (enabled) =>
        set((state) => {
          state.experimentalChatEnabled = enabled;
        }),

      // Agent chat setters
      setAgentConfig: (config) =>
        set((state) => {
          state.agentConfig = config;
        }),

      setAgentMessages: (messages) =>
        set((state) => {
          state.agentMessages = messages;
        }),

      setAgentState: (agentState) =>
        set((state) => {
          state.agentState = agentState;
        }),

      setAgentError: (error) =>
        set((state) => {
          state.agentError = error;
        }),

      appendAgentStreamingChunk: (messageId, content, contentType, resourceData) =>
        set((state) => {
          let msg = state.agentMessages.find((m) => m.id === messageId);
          if (!msg) {
            const isSystem = messageId.startsWith("system-");
            msg = {
              id: messageId,
              role: isSystem ? "system" : "assistant",
              content: "",
              timestamp: new Date().toISOString(),
              isStreaming: !isSystem,
              isThinking: !isSystem,
              contentBlocks: [],
            };
            state.agentMessages.push(msg);
          }

          msg.isStreaming = true;

          const blockType = contentType ?? "text";

          if (blockType === "text" && content) {
            if (msg.isThinking) {
              msg.isThinking = false;
            }
            msg.content += content;
          } else if (blockType === "resource_link" && resourceData?.uri) {
            if (!msg.contentBlocks) {
              msg.contentBlocks = [];
            }
            msg.contentBlocks.push({
              type: "resource_link",
              uri: resourceData.uri,
              name: resourceData.name,
              mimeType: resourceData.mimeType,
            });
          } else if (blockType === "resource" && resourceData?.uri) {
            if (!msg.contentBlocks) {
              msg.contentBlocks = [];
            }
            msg.contentBlocks.push({
              type: "resource",
              uri: resourceData.uri,
              name: resourceData.name,
              mimeType: resourceData.mimeType,
              text: resourceData.text,
            });
          } else if (blockType === "thinking" && content) {
            msg.isThinking = true;
            if (!msg.contentBlocks) {
              msg.contentBlocks = [];
            }
            msg.contentBlocks.push({ type: "thinking", text: content });
          }
        }),

      finalizeAgentMessage: (messageId, stopReason) =>
        set((state) => {
          const msg = state.agentMessages.find((m) => m.id === messageId);
          if (msg) {
            msg.isStreaming = false;
            msg.isThinking = false;
            if (stopReason) {
              msg.stopReason = stopReason;
            }
          }
        }),

      cancelAgentMessage: (messageId) =>
        set((state) => {
          const msg = state.agentMessages.find((m) => m.id === messageId);
          if (msg) {
            msg.isStreaming = false;
            msg.isCancelled = true;
            msg.isThinking = false;
            msg.stopReason = "cancelled";
          }
        }),

      setAgentThinking: (messageId, isThinking) =>
        set((state) => {
          const msg = state.agentMessages.find((m) => m.id === messageId);
          if (msg) {
            msg.isThinking = isThinking;
          }
        }),

      updateAgentToolCall: (messageId, toolName, status, result) =>
        set((state) => {
          let msg = state.agentMessages.find((m) => m.id === messageId);
          if (!msg) {
            msg = {
              id: messageId,
              role: "assistant",
              content: "",
              timestamp: new Date().toISOString(),
              isStreaming: true,
              contentBlocks: [],
            };
            state.agentMessages.push(msg);
          }
          msg.toolCall = {
            name: toolName,
            status,
            result,
          };
          if (status === "succeeded" || status === "failed") {
            msg.isStreaming = false;
          }
        }),

      clearAnalysisData: () =>
        set((state) => {
          state.ruleSets = [];
          state.enhancedIncidents = [];
        }),

      batchUpdate: (updates) =>
        set((state) => {
          Object.assign(state, updates);
        }),
    })),
  ),
);

export const selectIncidentCount = (state: ExtensionStore) => state.enhancedIncidents.length;

export const selectIncidentsByFile = (state: ExtensionStore) => {
  const byFile = new Map<string, EnhancedIncident[]>();
  state.enhancedIncidents.forEach((incident) => {
    const uri = incident.uri;
    if (!byFile.has(uri)) {
      byFile.set(uri, []);
    }
    byFile.get(uri)!.push(incident);
  });
  return byFile;
};

export const selectIsLoading = (state: ExtensionStore) =>
  state.isAnalyzing ||
  state.isFetchingSolution ||
  state.isStartingServer ||
  state.isInitializingServer;
