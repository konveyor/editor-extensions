import {
  EnhancedIncident,
  ExtensionData,
  LocalChange,
  Scope,
  ScopeWithKonveyorContext,
  WebviewAction,
  WebviewActionType,
} from "@editor-extensions/shared";

export const setExtensionData = (
  data: ExtensionData,
): WebviewAction<WebviewActionType, ExtensionData> => ({
  type: "SET_STATE",
  payload: data,
});

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

export const cancelSolution = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "CANCEL_SOLUTION",
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

export const viewFix = (change: LocalChange): WebviewAction<WebviewActionType, LocalChange> => ({
  type: "VIEW_FIX",
  payload: change,
});

export const configureLabelSelector = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "CONFIGURE_LABEL_SELECTOR",
  payload: {}, // no payload needed here, but could pass data if needed
});

export const configureSourcesTargets = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "CONFIGURE_SOURCES_TARGETS",
  payload: {},
});

export const overrideAnalyzerBinaries = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "OVERRIDE_ANALYZER_BINARIES",
  payload: {},
});

export const configureModelProviderSettings = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "OPEN_GENAI_SETTINGS",
  payload: {},
});

export const getSuccessRate = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "GET_SUCCESS_RATE",
  payload: {},
});

export const toggleAgentMode = (): WebviewAction<WebviewActionType, unknown> => ({
  type: "TOGGLE_AGENT_MODE",
  payload: {},
});
