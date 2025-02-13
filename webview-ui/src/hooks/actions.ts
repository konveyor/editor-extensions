import {
  EnhancedIncident,
  ExtensionData,
  LocalChange,
  Scope,
  SolutionEffortLevel,
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
  effort: SolutionEffortLevel,
): WebviewAction<WebviewActionType, Scope> => ({
  type: "GET_SOLUTION",
  payload: { incidents, effort },
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

export const applyFile = (change: LocalChange): WebviewAction<WebviewActionType, LocalChange> => ({
  type: "APPLY_FILE",
  payload: change,
});

export const discardFile = (
  change: LocalChange,
): WebviewAction<WebviewActionType, LocalChange> => ({
  type: "DISCARD_FILE",
  payload: change,
});
