import {
  AnalysisStateUpdateMessage,
  ChatMessagesUpdateMessage,
  SolutionWorkflowUpdateMessage,
  ServerStateUpdateMessage,
  ProfilesUpdateMessage,
  ConfigErrorsUpdateMessage,
  DecoratorsUpdateMessage,
  SettingsUpdateMessage,
  RuleSet,
  EnhancedIncident,
  ChatMessage,
  SolutionState,
  Scope,
  ServerState,
  AnalysisProfile,
  ConfigError,
} from "@editor-extensions/shared";
import { ExtensionState } from "../extensionState";

/**
 * Helper functions for broadcasting granular state updates to webviews
 *
 * These functions send specific slices of state instead of full state broadcasts,
 * improving performance by reducing unnecessary re-renders
 */

function broadcastToAllWebviews(state: ExtensionState, message: any) {
  state.webviewProviders.forEach((provider) => {
    provider.sendMessageToWebview(message);
  });
}

/**
 * Broadcast analysis state updates (ruleSets, incidents, analyzing status)
 */
export function broadcastAnalysisState(
  state: ExtensionState,
  data: {
    ruleSets: RuleSet[];
    enhancedIncidents: EnhancedIncident[];
    isAnalyzing: boolean;
    isAnalysisScheduled: boolean;
    analysisProgress?: number;
    analysisProgressMessage?: string;
  },
) {
  const message: AnalysisStateUpdateMessage = {
    type: "ANALYSIS_STATE_UPDATE",
    ruleSets: data.ruleSets,
    enhancedIncidents: data.enhancedIncidents,
    isAnalyzing: data.isAnalyzing,
    isAnalysisScheduled: data.isAnalysisScheduled,
    analysisProgress: data.analysisProgress,
    analysisProgressMessage: data.analysisProgressMessage,
    timestamp: new Date().toISOString(),
  };
  broadcastToAllWebviews(state, message);
}

/**
 * Broadcast chat messages (already implemented in mutateChatMessages)
 */
export function broadcastChatMessages(
  state: ExtensionState,
  chatMessages: ChatMessage[],
  previousLength: number,
) {
  const message: ChatMessagesUpdateMessage = {
    type: "CHAT_MESSAGES_UPDATE",
    chatMessages,
    previousLength,
    timestamp: new Date().toISOString(),
  };
  broadcastToAllWebviews(state, message);
}

/**
 * Broadcast solution workflow updates
 */
export function broadcastSolutionWorkflow(
  state: ExtensionState,
  data: {
    isFetchingSolution: boolean;
    solutionState: SolutionState;
    solutionScope?: Scope;
    isWaitingForUserInteraction?: boolean;
    isProcessingQueuedMessages?: boolean;
    pendingBatchReview?: any[];
  },
) {
  const message: SolutionWorkflowUpdateMessage = {
    type: "SOLUTION_WORKFLOW_UPDATE",
    isFetchingSolution: data.isFetchingSolution,
    solutionState: data.solutionState,
    solutionScope: data.solutionScope,
    isWaitingForUserInteraction: data.isWaitingForUserInteraction,
    isProcessingQueuedMessages: data.isProcessingQueuedMessages,
    pendingBatchReview: data.pendingBatchReview,
    timestamp: new Date().toISOString(),
  };
  broadcastToAllWebviews(state, message);
}

/**
 * Broadcast server state updates
 */
export function broadcastServerState(
  state: ExtensionState,
  data: {
    serverState: ServerState;
    isStartingServer: boolean;
    isInitializingServer: boolean;
    solutionServerConnected: boolean;
  },
) {
  const message: ServerStateUpdateMessage = {
    type: "SERVER_STATE_UPDATE",
    serverState: data.serverState,
    isStartingServer: data.isStartingServer,
    isInitializingServer: data.isInitializingServer,
    solutionServerConnected: data.solutionServerConnected,
    timestamp: new Date().toISOString(),
  };
  broadcastToAllWebviews(state, message);
}

/**
 * Broadcast profile updates
 */
export function broadcastProfiles(
  state: ExtensionState,
  profiles: AnalysisProfile[],
  activeProfileId: string | null,
) {
  const message: ProfilesUpdateMessage = {
    type: "PROFILES_UPDATE",
    profiles,
    activeProfileId,
    timestamp: new Date().toISOString(),
  };
  broadcastToAllWebviews(state, message);
}

/**
 * Broadcast config errors
 */
export function broadcastConfigErrors(state: ExtensionState, configErrors: ConfigError[]) {
  const message: ConfigErrorsUpdateMessage = {
    type: "CONFIG_ERRORS_UPDATE",
    configErrors,
    timestamp: new Date().toISOString(),
  };
  broadcastToAllWebviews(state, message);
}

/**
 * Broadcast decorator updates
 */
export function broadcastDecorators(
  state: ExtensionState,
  activeDecorators: Record<string, string>,
) {
  const message: DecoratorsUpdateMessage = {
    type: "DECORATORS_UPDATE",
    activeDecorators,
    timestamp: new Date().toISOString(),
  };
  broadcastToAllWebviews(state, message);
}

/**
 * Broadcast settings updates
 */
export function broadcastSettings(
  state: ExtensionState,
  data: {
    solutionServerEnabled: boolean;
    isAgentMode: boolean;
    isContinueInstalled: boolean;
  },
) {
  const message: SettingsUpdateMessage = {
    type: "SETTINGS_UPDATE",
    solutionServerEnabled: data.solutionServerEnabled,
    isAgentMode: data.isAgentMode,
    isContinueInstalled: data.isContinueInstalled,
    timestamp: new Date().toISOString(),
  };
  broadcastToAllWebviews(state, message);
}
