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
import {
  createHubActions,
  createAnalysisActions,
  createProfilesActions,
  createSolutionWorkflowActions,
  createServerActions,
  createDecoratorsActions,
  createConfigActions,
  createSettingsActions,
  createChatActions,
  type HubDomainActions,
  type AnalysisDomainActions,
  type ProfilesDomainActions,
  type SolutionWorkflowDomainActions,
  type ServerDomainActions,
  type DecoratorsDomainActions,
  type ConfigDomainActions,
  type SettingsDomainActions,
  type ChatDomainActions,
} from "./domains";

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

  // Profiles (Note: domain actions use 'profiles' namespace)
  profilesList: AnalysisProfile[];
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
 * Legacy CRUD actions
 *
 * These are low-level state setters used primarily for:
 * - Extension initialization (loading persisted state)
 * - Backward compatibility during migration
 * - Direct state access when domain actions don't apply
 *
 * ⚠️ For new code, prefer domain actions (hub.*, analysis.*, etc.)
 *   Domain actions encapsulate business logic and are self-documenting.
 */
export interface ExtensionStoreActions {
  // ============================================
  // BATCH UPDATE ACTIONS (Preferred for initialization)
  // ============================================

  /**
   * Batch update analysis state (used during initialization)
   * ⚠️ Prefer: analysis.complete() for business operations
   */
  updateAnalysisState: (updates: {
    ruleSets?: RuleSet[];
    enhancedIncidents?: EnhancedIncident[];
    isAnalyzing?: boolean;
    analysisProgress?: number;
    analysisProgressMessage?: string;
    isAnalysisScheduled?: boolean;
  }) => void;

  /**
   * Batch update profile state (used during initialization)
   * ⚠️ Prefer: profiles.load() for business operations
   */
  updateProfiles: (updates: {
    profilesList?: AnalysisProfile[];
    activeProfileId?: string | null;
    isInTreeMode?: boolean;
  }) => void;

  /**
   * Batch update server state (used during initialization)
   * ⚠️ Prefer: hub.connection.syncStatus() for business operations
   */
  updateServerState: (updates: {
    serverState?: ServerState;
    isStartingServer?: boolean;
    isInitializingServer?: boolean;
    solutionServerConnected?: boolean;
    profileSyncConnected?: boolean;
    llmProxyAvailable?: boolean;
  }) => void;

  /**
   * Batch update solution workflow state (used during initialization)
   * ⚠️ Prefer: solutionWorkflow.* actions for business operations (future)
   */
  updateSolutionWorkflow: (updates: {
    isFetchingSolution?: boolean;
    solutionState?: SolutionState;
    solutionScope?: Scope;
    isWaitingForUserInteraction?: boolean;
    isProcessingQueuedMessages?: boolean;
    pendingBatchReview?: PendingBatchReviewFile[];
  }) => void;

  /**
   * Batch update settings (used during initialization)
   * ⚠️ Prefer: hub.applyConfigurationFromUI() for business operations
   */
  updateSettings: (updates: {
    solutionServerEnabled?: boolean;
    isAgentMode?: boolean;
    isContinueInstalled?: boolean;
    hubConfig?: HubConfig;
    profileSyncEnabled?: boolean;
    isSyncingProfiles?: boolean;
    llmProxyAvailable?: boolean;
  }) => void;

  // ============================================
  // SINGLE-FIELD SETTERS (Use sparingly)
  // ============================================

  // Chat messages (no domain actions yet - uses on-demand fetching)
  setChatMessages: (messages: ChatMessage[]) => void;
  addChatMessage: (message: ChatMessage) => void;
  clearChatMessages: () => void;

  // Config errors (no domain actions yet)
  setConfigErrors: (errors: ConfigError[]) => void;
  addConfigError: (error: ConfigError) => void;
  removeConfigError: (type: ConfigError["type"]) => void;
  clearConfigErrors: () => void;

  // LLM errors (no domain actions yet)
  setLlmErrors: (errors: LLMError[]) => void;
  addLlmError: (error: LLMError) => void;
  clearLlmErrors: () => void;

  // Decorators (no domain actions yet)
  setActiveDecorators: (decorators: Record<string, string>) => void;
  addActiveDecorator: (streamId: string, value: string) => void;
  removeActiveDecorator: (streamId: string) => void;
  clearActiveDecorators: () => void;

  // Workspace
  setWorkspaceRoot: (root: string) => void;

  // ============================================
  // UTILITY ACTIONS
  // ============================================

  /**
   * Clear all analysis data
   * ⚠️ Prefer: analysis.clearResults() when domain is created
   */
  clearAnalysisData: () => void;

  /**
   * Reset entire store to initial state
   */
  reset: () => void;
}

/**
 * Combined store type with all domain actions
 */
export type ExtensionStore = ExtensionStoreState &
  ExtensionStoreActions &
  HubDomainActions &
  AnalysisDomainActions &
  ProfilesDomainActions &
  SolutionWorkflowDomainActions &
  ServerDomainActions &
  DecoratorsDomainActions &
  ConfigDomainActions &
  SettingsDomainActions &
  ChatDomainActions;

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
  profilesList: [],
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
 *
 * The store is composed of:
 * - Initial state
 * - Legacy CRUD actions (being phased out)
 * - Domain-driven actions (new pattern)
 */
export const extensionStore = createStore<ExtensionStore>()(
  subscribeWithSelector(
    immer((set, get, store) => ({
      ...initialState,

      // ============================================
      // DOMAIN ACTIONS (Merged from domain modules)
      // ============================================
      ...createHubActions(set, get, store),
      ...createAnalysisActions(set, get, store),
      ...createProfilesActions(set, get, store),
      ...createSolutionWorkflowActions(set, get, store),
      ...createServerActions(set, get, store),
      ...createDecoratorsActions(set, get, store),
      ...createConfigActions(set, get, store),
      ...createSettingsActions(set, get, store),
      ...createChatActions(set, get, store),

      // ============================================
      // LEGACY CRUD ACTIONS (For initialization & backward compatibility)
      // ============================================

      // Batch updates (preferred for initialization)
      updateAnalysisState: (updates) =>
        set((state) => {
          Object.assign(state, updates);
        }),

      updateProfiles: (updates) =>
        set((state) => {
          Object.assign(state, updates);
        }),

      updateServerState: (updates) =>
        set((state) => {
          Object.assign(state, updates);
        }),

      updateSolutionWorkflow: (updates) =>
        set((state) => {
          Object.assign(state, updates);
        }),

      updateSettings: (updates) =>
        set((state) => {
          Object.assign(state, updates);
        }),

      // Chat actions (no domain yet - uses on-demand fetching)
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

      // Decorator actions (legacy - prefer decorators.* domain actions)
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

      // Workspace
      setWorkspaceRoot: (root) =>
        set((state) => {
          state.workspaceRoot = root;
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
