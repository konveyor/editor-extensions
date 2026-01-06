import {
  EnhancedIncident,
  Scope,
  ScopeWithKonveyorContext,
  WebviewAction,
  WebviewActionType,
} from "@editor-extensions/shared";

export const runAnalysis = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "RUN_ANALYSIS",
  payload: {},
});

export const startServer = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "START_SERVER",
  payload: {},
});

export const stopServer = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "STOP_SERVER",
  payload: {},
});

export const restartSolutionServer = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "RESTART_SOLUTION_SERVER",
  payload: {},
});

export const enableGenAI = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "ENABLE_GENAI",
  payload: {},
});

export const getSolution = (
  incidents: EnhancedIncident[],
): WebviewAction<WebviewActionType, Scope> => ({
  type: "GET_SOLUTION",
  payload: { incidents },
});

export const getSolutionWithKonveyorContext = (
  incident: EnhancedIncident,
): WebviewAction<WebviewActionType, ScopeWithKonveyorContext> => ({
  type: "GET_SOLUTION_WITH_KONVEYOR_CONTEXT",
  payload: { incident },
});

export const openFile = (
  file: string,
  line: number,
): WebviewAction<WebviewActionType, { file: string; line: number }> => ({
  type: "OPEN_FILE",
  payload: { file, line },
});

export const getSuccessRate = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "GET_SUCCESS_RATE",
  payload: {},
});

export const toggleAgentMode = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "TOGGLE_AGENT_MODE",
  payload: {},
});

export const openResolutionPanel = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "OPEN_RESOLUTION_PANEL",
  payload: {},
});

export const syncHubProfiles = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "SYNC_HUB_PROFILES",
  payload: {},
});

export const retryProfileSync = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "RETRY_PROFILE_SYNC",
  payload: {},
});
