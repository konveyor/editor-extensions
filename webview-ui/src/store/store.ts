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
} from "@editor-extensions/shared";

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
  isAgentMode: boolean;
  isContinueInstalled: boolean;
  hubConfig?: HubConfig;
  profileSyncEnabled: boolean;
  profileSyncConnected: boolean;
  isSyncingProfiles: boolean;
  llmProxyAvailable: boolean;

  // Batch review state
  pendingBatchReview: PendingBatchReviewFile[];
  isBatchOperationInProgress: boolean;

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
  setIsAgentMode: (isAgentMode: boolean) => void;
  setIsContinueInstalled: (isInstalled: boolean) => void;
  setHubConfig: (config: HubConfig | undefined) => void;
  setWorkspaceRoot: (root: string) => void;
  setProfileSyncEnabled: (enabled: boolean) => void;
  setProfileSyncConnected: (connected: boolean) => void;
  setIsSyncingProfiles: (isSyncing: boolean) => void;
  setLlmProxyAvailable: (available: boolean) => void;

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
      isAgentMode: false,
      isContinueInstalled: false,
      hubConfig: undefined,
      profileSyncEnabled: false,
      profileSyncConnected: false,
      isSyncingProfiles: false,
      llmProxyAvailable: false,

      // Batch review state
      pendingBatchReview: [],
      isBatchOperationInProgress: false,

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

      setIsAgentMode: (isAgentMode) =>
        set((state) => {
          state.isAgentMode = isAgentMode;
        }),

      setIsContinueInstalled: (isInstalled) =>
        set((state) => {
          state.isContinueInstalled = isInstalled;
        }),

      setHubConfig: (config) =>
        set((state) => {
          state.hubConfig = config;
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
