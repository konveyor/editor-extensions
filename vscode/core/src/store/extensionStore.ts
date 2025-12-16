/**
 * Vanilla Zustand Store for Extension Host
 *
 * This store manages state in the extension host (Node.js context) and syncs
 * with webviews through sync bridges. Unlike the webview store which uses
 * `create` from 'zustand', this uses `createStore` from 'zustand/vanilla'
 * which works in Node.js environments.
 *
 * Key differences from webview store:
 * - Uses vanilla store (no React hooks)
 * - State syncs TO webviews (not FROM)
 * - Can be subscribed to from extension code
 */

import { createStore } from "zustand/vanilla";
import { subscribeWithSelector } from "zustand/middleware";
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
  LLMError,
} from "@editor-extensions/shared";

/**
 * Extension store state interface matching ExtensionData
 */
export interface ExtensionStoreState {
  // Workspace
  workspaceRoot: string;

  // Analysis state
  ruleSets: RuleSet[];
  enhancedIncidents: EnhancedIncident[];
  isAnalyzing: boolean;
  analysisProgress?: number;
  analysisProgressMessage?: string;
  isAnalysisScheduled: boolean;

  // Profiles
  profiles: AnalysisProfile[];
  activeProfileId: string | null;
  isInTreeMode: boolean;

  // Server state
  serverState: ServerState;
  isStartingServer: boolean;
  isInitializingServer: boolean;
  solutionServerConnected: boolean;
  profileSyncConnected: boolean;
  llmProxyAvailable: boolean;

  // Solution workflow
  isFetchingSolution: boolean;
  solutionState: SolutionState;
  solutionScope?: Scope;
  isWaitingForUserInteraction: boolean;
  isProcessingQueuedMessages: boolean;
  pendingBatchReview: PendingBatchReviewFile[];

  // Chat messages (stored but not synced - use on-demand fetch)
  chatMessages: ChatMessage[];

  // Config and errors
  configErrors: ConfigError[];
  llmErrors: LLMError[];

  // Settings
  solutionServerEnabled: boolean;
  isAgentMode: boolean;
  isContinueInstalled: boolean;
  hubConfig: HubConfig | undefined;
  profileSyncEnabled: boolean;
  isSyncingProfiles: boolean;

  // UI state
  activeDecorators: Record<string, string>;
}

/**
 * Extension store actions
 */
export interface ExtensionStoreActions {
  // Analysis actions
  setRuleSets: (ruleSets: RuleSet[]) => void;
  setEnhancedIncidents: (incidents: EnhancedIncident[]) => void;
  setIsAnalyzing: (isAnalyzing: boolean) => void;
  setAnalysisProgress: (progress: number | undefined) => void;
  setAnalysisProgressMessage: (message: string | undefined) => void;
  setIsAnalysisScheduled: (isScheduled: boolean) => void;
  updateAnalysisState: (updates: {
    ruleSets?: RuleSet[];
    enhancedIncidents?: EnhancedIncident[];
    isAnalyzing?: boolean;
    analysisProgress?: number;
    analysisProgressMessage?: string;
    isAnalysisScheduled?: boolean;
  }) => void;

  // Profile actions
  setProfiles: (profiles: AnalysisProfile[]) => void;
  setActiveProfileId: (profileId: string | null) => void;
  setIsInTreeMode: (isInTreeMode: boolean) => void;
  updateProfiles: (updates: {
    profiles?: AnalysisProfile[];
    activeProfileId?: string | null;
    isInTreeMode?: boolean;
  }) => void;

  // Server actions
  setServerState: (state: ServerState) => void;
  setIsStartingServer: (isStarting: boolean) => void;
  setIsInitializingServer: (isInitializing: boolean) => void;
  setSolutionServerConnected: (connected: boolean) => void;
  setProfileSyncConnected: (connected: boolean) => void;
  setLlmProxyAvailable: (available: boolean) => void;
  updateServerState: (updates: {
    serverState?: ServerState;
    isStartingServer?: boolean;
    isInitializingServer?: boolean;
    solutionServerConnected?: boolean;
    profileSyncConnected?: boolean;
    llmProxyAvailable?: boolean;
  }) => void;

  // Solution workflow actions
  setIsFetchingSolution: (isFetching: boolean) => void;
  setSolutionState: (state: SolutionState) => void;
  setSolutionScope: (scope: Scope | undefined) => void;
  setIsWaitingForUserInteraction: (isWaiting: boolean) => void;
  setIsProcessingQueuedMessages: (isProcessing: boolean) => void;
  setPendingBatchReview: (files: PendingBatchReviewFile[]) => void;
  updateSolutionWorkflow: (updates: {
    isFetchingSolution?: boolean;
    solutionState?: SolutionState;
    solutionScope?: Scope;
    isWaitingForUserInteraction?: boolean;
    isProcessingQueuedMessages?: boolean;
    pendingBatchReview?: PendingBatchReviewFile[];
  }) => void;

  // Chat actions (stored locally, not synced)
  addChatMessage: (message: ChatMessage) => void;
  setChatMessages: (messages: ChatMessage[]) => void;
  clearChatMessages: () => void;

  // Config and error actions
  setConfigErrors: (errors: ConfigError[]) => void;
  addConfigError: (error: ConfigError) => void;
  removeConfigError: (type: ConfigError["type"]) => void;
  clearConfigErrors: () => void;
  setLlmErrors: (errors: LLMError[]) => void;
  addLlmError: (error: LLMError) => void;
  clearLlmErrors: () => void;

  // Settings actions
  setSolutionServerEnabled: (enabled: boolean) => void;
  setIsAgentMode: (isAgentMode: boolean) => void;
  setIsContinueInstalled: (isInstalled: boolean) => void;
  setHubConfig: (config: HubConfig | undefined) => void;
  setProfileSyncEnabled: (enabled: boolean) => void;
  setIsSyncingProfiles: (isSyncing: boolean) => void;
  setWorkspaceRoot: (root: string) => void;
  updateSettings: (updates: {
    solutionServerEnabled?: boolean;
    isAgentMode?: boolean;
    isContinueInstalled?: boolean;
    hubConfig?: HubConfig;
    profileSyncEnabled?: boolean;
    isSyncingProfiles?: boolean;
    llmProxyAvailable?: boolean;
  }) => void;

  // Decorator actions
  setActiveDecorators: (decorators: Record<string, string>) => void;
  addActiveDecorator: (streamId: string, value: string) => void;
  removeActiveDecorator: (streamId: string) => void;
  clearActiveDecorators: () => void;

  // Utility actions
  clearAnalysisData: () => void;
  reset: () => void;
}

/**
 * Combined store type
 */
export type ExtensionStore = ExtensionStoreState & ExtensionStoreActions;

/**
 * Initial state
 */
const initialState: ExtensionStoreState = {
  workspaceRoot: "/",
  ruleSets: [],
  enhancedIncidents: [],
  isAnalyzing: false,
  analysisProgress: undefined,
  analysisProgressMessage: undefined,
  isAnalysisScheduled: false,
  profiles: [],
  activeProfileId: null,
  isInTreeMode: false,
  serverState: "initial",
  isStartingServer: false,
  isInitializingServer: false,
  solutionServerConnected: false,
  profileSyncConnected: false,
  llmProxyAvailable: false,
  isFetchingSolution: false,
  solutionState: "none",
  solutionScope: undefined,
  isWaitingForUserInteraction: false,
  isProcessingQueuedMessages: false,
  pendingBatchReview: [],
  chatMessages: [],
  configErrors: [],
  llmErrors: [],
  solutionServerEnabled: false,
  isAgentMode: false,
  isContinueInstalled: false,
  hubConfig: undefined,
  profileSyncEnabled: false,
  isSyncingProfiles: false,
  activeDecorators: {},
};

/**
 * Create the extension store
 *
 * This uses subscribeWithSelector middleware to enable selective subscriptions
 * and immer middleware for convenient mutable updates.
 */
export const extensionStore = createStore<ExtensionStore>()(
  subscribeWithSelector(
    immer((set) => ({
      ...initialState,

      // Analysis actions
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

      updateAnalysisState: (updates) =>
        set((state) => {
          Object.assign(state, updates);
        }),

      // Profile actions
      setProfiles: (profiles) =>
        set((state) => {
          state.profiles = profiles;
        }),

      setActiveProfileId: (profileId) =>
        set((state) => {
          state.activeProfileId = profileId;
        }),

      setIsInTreeMode: (isInTreeMode) =>
        set((state) => {
          state.isInTreeMode = isInTreeMode;
        }),

      updateProfiles: (updates) =>
        set((state) => {
          Object.assign(state, updates);
        }),

      // Server actions
      setServerState: (serverState) =>
        set((state) => {
          state.serverState = serverState;
        }),

      setIsStartingServer: (isStarting) =>
        set((state) => {
          state.isStartingServer = isStarting;
        }),

      setIsInitializingServer: (isInitializing) =>
        set((state) => {
          state.isInitializingServer = isInitializing;
        }),

      setSolutionServerConnected: (connected) =>
        set((state) => {
          state.solutionServerConnected = connected;
        }),

      setProfileSyncConnected: (connected) =>
        set((state) => {
          state.profileSyncConnected = connected;
        }),

      setLlmProxyAvailable: (available) =>
        set((state) => {
          state.llmProxyAvailable = available;
        }),

      updateServerState: (updates) =>
        set((state) => {
          Object.assign(state, updates);
        }),

      // Solution workflow actions
      setIsFetchingSolution: (isFetching) =>
        set((state) => {
          state.isFetchingSolution = isFetching;
        }),

      setSolutionState: (solutionState) =>
        set((state) => {
          state.solutionState = solutionState;
        }),

      setSolutionScope: (scope) =>
        set((state) => {
          state.solutionScope = scope;
        }),

      setIsWaitingForUserInteraction: (isWaiting) =>
        set((state) => {
          state.isWaitingForUserInteraction = isWaiting;
        }),

      setIsProcessingQueuedMessages: (isProcessing) =>
        set((state) => {
          state.isProcessingQueuedMessages = isProcessing;
        }),

      setPendingBatchReview: (files) =>
        set((state) => {
          state.pendingBatchReview = files;
        }),

      updateSolutionWorkflow: (updates) =>
        set((state) => {
          Object.assign(state, updates);
        }),

      // Chat actions
      addChatMessage: (message) =>
        set((state) => {
          state.chatMessages.push(message);
        }),

      setChatMessages: (messages) =>
        set((state) => {
          state.chatMessages = messages;
        }),

      clearChatMessages: () =>
        set((state) => {
          state.chatMessages = [];
        }),

      // Config and error actions
      setConfigErrors: (errors) =>
        set((state) => {
          state.configErrors = errors;
        }),

      addConfigError: (error) =>
        set((state) => {
          // Avoid duplicates
          const exists = state.configErrors.some((e) => e.type === error.type);
          if (!exists) {
            state.configErrors.push(error);
          }
        }),

      removeConfigError: (type) =>
        set((state) => {
          state.configErrors = state.configErrors.filter((e) => e.type !== type);
        }),

      clearConfigErrors: () =>
        set((state) => {
          state.configErrors = [];
        }),

      setLlmErrors: (errors) =>
        set((state) => {
          state.llmErrors = errors;
        }),

      addLlmError: (error) =>
        set((state) => {
          state.llmErrors.push(error);
        }),

      clearLlmErrors: () =>
        set((state) => {
          state.llmErrors = [];
        }),

      // Settings actions
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

      setProfileSyncEnabled: (enabled) =>
        set((state) => {
          state.profileSyncEnabled = enabled;
        }),

      setIsSyncingProfiles: (isSyncing) =>
        set((state) => {
          state.isSyncingProfiles = isSyncing;
        }),

      setWorkspaceRoot: (root) =>
        set((state) => {
          state.workspaceRoot = root;
        }),

      updateSettings: (updates) =>
        set((state) => {
          Object.assign(state, updates);
        }),

      // Decorator actions
      setActiveDecorators: (decorators) =>
        set((state) => {
          state.activeDecorators = decorators;
        }),

      addActiveDecorator: (streamId, value) =>
        set((state) => {
          state.activeDecorators[streamId] = value;
        }),

      removeActiveDecorator: (streamId) =>
        set((state) => {
          delete state.activeDecorators[streamId];
        }),

      clearActiveDecorators: () =>
        set((state) => {
          state.activeDecorators = {};
        }),

      // Utility actions
      clearAnalysisData: () =>
        set((state) => {
          state.ruleSets = [];
          state.enhancedIncidents = [];
        }),

      reset: () => set(initialState),
    })),
  ),
);

/**
 * Helper to get current state
 */
export const getExtensionState = () => extensionStore.getState();

/**
 * Helper to update state
 */
export const updateExtensionState = (updates: Partial<ExtensionStoreState>) => {
  extensionStore.setState(updates);
};
