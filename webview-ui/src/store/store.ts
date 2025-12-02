/**
 * Zustand Store POC
 *
 * ✅ BENEFITS over Redux Toolkit:
 * - Much simpler API
 * - No boilerplate (no slices, actions, reducers)
 * - Still has selector-based subscriptions
 * - Smaller bundle size (~1KB)
 * - Can optionally use Immer middleware
 *
 * ✅ BENEFITS over current Context approach:
 * - Selective subscriptions (no unnecessary re-renders)
 * - Better performance
 * - Can still use Immer but in a smarter way
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
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

/**
 * Maximum number of chat messages to keep in memory.
 * NOTE: This constant is duplicated in useVSCodeMessageHandler.ts
 * TODO: Consider consolidating into a shared constants file
 *
 * Must match the value in useVSCodeMessageHandler.ts
 */
const MAX_CHAT_MESSAGES = 50000;

// ✅ BENEFIT: Single interface for entire state (simpler than Redux slices)
interface ExtensionStore {
  // Analysis state
  ruleSets: RuleSet[];
  enhancedIncidents: EnhancedIncident[];
  profiles: AnalysisProfile[];
  activeProfileId: string | null;
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

  // Batch review state
  pendingBatchReview: PendingBatchReviewFile[];
  isBatchOperationInProgress: boolean;

  // ✅ BENEFIT: Actions are just methods on the store
  // No need for separate action creators like Redux
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

  // Utility
  clearAnalysisData: () => void;

  // Batch updates for complex state changes
  batchUpdate: (updates: Partial<ExtensionStore>) => void;
}

/**
 * ✅ BENEFIT: Create store with middleware stack
 * - immer: Safe mutations (optional, can remove for max performance)
 * - devtools: Redux DevTools integration
 * - persist: Persist to localStorage
 */
export const useExtensionStore = create<ExtensionStore>()(
  devtools(
    persist(
      immer((set) => ({
        // Initial state
        ruleSets: [],
        enhancedIncidents: [],
        profiles: [],
        activeProfileId: null,
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

        // Batch review state
        pendingBatchReview: [],
        isBatchOperationInProgress: false,

        // ✅ BENEFIT: Actions are simple functions
        // With Immer middleware, you can write mutable code
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

        // ✅ BENEFIT: Complex logic in actions
        addChatMessage: (message) =>
          set((state) => {
            state.chatMessages.push(message);

            // Auto-limit messages to prevent memory issues
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
      {
        name: "konveyor-storage",
        // ✅ Only persist specific fields
        partialize: (state) => ({
          activeProfileId: state.activeProfileId,
          profiles: state.profiles,
          isAgentMode: state.isAgentMode,
          solutionServerEnabled: state.solutionServerEnabled,
          // NOT persisting large arrays like ruleSets or enhancedIncidents
        }),
      },
    ),
  ),
);

/**
 * ✅ BENEFIT: Can create derived selectors (like Redux)
 * But without the boilerplate
 */
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
